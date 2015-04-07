require('source-map-support').install();
import schema = require('../schema');
import rules = require('../blaze');
import expression = require('../expression');
import fs = require('fs');
import gen = require('./javasource');
var TARGET: string = "root.java";
var DEBUG: boolean;

/*
Built quickly for experiment week
Improvements:
Java code generation should be in another module and fluent, perhaps using something like https://github.com/UnquietCode/Flapi
Lots of short lived objects, maybe a better design is to use a single builder,
which exposes each step by returning an interface of itself (nested builders are still seperate objects). The builder tracks what stage it is in via a state counter

The state is basically what variables have been set so far and what will come next.

http://www.unquietcode.com/blog/2011/programming/using-generics-to-build-fluent-apis-in-java/


 */

var TARGET_FIREBASE_URL: string = "https://firesafe-sandbox.firebaseio.com";

var PREAMBLE = fs.readFileSync("src/java/preamble.java").toString(); //todo move into js file
var TEST = fs.readFileSync("src/java/test.java").toString(); //todo move into js file
/**
 * from a compiled model of the rules, a typed java source file is created
 */
export function generate(model: rules.Rules, target_dir: string, debug: boolean) {
    console.log("generating", TARGET);
    DEBUG = false; //debug;

    //big array we put all the output in
    var output: string[] = [];

    new gen.JFile()
        .setPackage("com.firebase.fluent")
        .addImport("com.firebase.client.Firebase")
        .addImport("java.util.HashMap")
        .addImport("java.util.Map")
        .write(output);

    generate_root(model.schema.root, 0, output);

    //writeLine(TEST, 0, output);
    fs.writeFile(target_dir + "/" + TARGET, output.join("\n"));
}

function writeLine(value: string, depth: number, output: string[]) {
    var prefix = Array(depth * 2).join(" ");
    var line = prefix + value;
    if (DEBUG) console.log(line);
    output.push(line);
}

function seperator(output: string[]) {
    if (DEBUG) console.log("");
    output.push("");
}

function pathClassIdentifier(schema: schema.SchemaNode): string {
    return "root$" + schema.getPath().join("$");
}
function builderClassIdentifier(schema: schema.SchemaNode): string {
    return "root$" + schema.getPath().join("$") + "$Builder";
}
function valueClassIdentifier(schema: schema.SchemaNode): string {
    return "root$" + schema.getPath().join("$") + "$Value";
}

function camelConcatinate(a: string, b: string): string {

    return a + b.charAt(0).toUpperCase() + b.slice(1);
}
function schemaToJavaTypes(schema: schema.SchemaNode): string[] {
    if (schema.type == "string") return ["String"];
    if (schema.type == "number") return ["Double", "Integer"];
}
function generate_path_field(name: string, schema: schema.SchemaNode, depth: number, output: string[], isStatic: boolean = false, class_prefix = "") {
    //var modifier = isStatic?"static ": "";
    //writeLine("public " + modifier + class_prefix + pathClassIdentifier(schema) + " " + name + " = new " + class_prefix + pathClassIdentifier(schema) + "();", depth, output);
    return new gen.JField()
        .setModifier(gen.Modifier.public)
        .setStatic(isStatic)
        .setType(class_prefix + pathClassIdentifier(schema))
        .setName(name)
        .setInitializer("new " + class_prefix + pathClassIdentifier(schema) + "()")
        .write(output, depth);
}
function generate_path_wild_function(name: string, schema: schema.SchemaNode, depth: number, output: string[], isStatic: boolean = false, class_prefix = "") {
    //var modifier = isStatic?"static ": "";
    //writeLine("public " + modifier + class_prefix + pathClassIdentifier(schema) + " $(String key) {return null;}", depth, output); //todo implementation
    return new gen.JMethod()
        .setModifier(gen.Modifier.public)
        .setStatic(isStatic)
        .setType(class_prefix + pathClassIdentifier(schema))
        .setName("$")
        .addParam(["String", "key"])
        .setBody(["return null;)"])
        .write(output, depth);

}
function generateRefConstructor(name: string, schema: schema.SchemaNode, depth: number, output: string[]) {
    //todo binding of variables
    var classname = pathClassIdentifier(schema);
    writeLine(classname + "() {", depth, output);
    writeLine("  super(new Firebase(\"" + schema.getPath().join("/") + "\"));", depth, output);
    writeLine("}", depth, output);
}
function generate_buildValue(name: string, schema: schema.SchemaNode, depth: number, output: string[]) {
    var valueClassname = builderClassIdentifier(schema) + "0";
    writeLine("public " + valueClassname + " openWrite() {", depth, output);
    writeLine("  return new " + valueClassname + "(this);", depth, output);
    writeLine("}", depth, output);
}
function generate_root_buildValue(schema: schema.SchemaNode, depth: number, output: string[]) {
    var valueClassname = builderClassIdentifier(schema) + "0";
    writeLine("public static _fluent_classes." + valueClassname + " openWrite() {", depth, output);
    writeLine("  return new _fluent_classes.root$$Builder0(new _fluent_classes.root$());", depth, output);
    writeLine("}", depth, output);
}

function generate_root(schema: schema.SchemaNode, depth: number, output: string[]) {
    writeLine("public class root {", depth, output);

    for (var child in schema.properties) {
        if (child.indexOf("$") == 0 || child.indexOf("~$") == 0) {
            generate_path_wild_function(child, schema.properties[child], depth + 1, output, true, "_fluent_classes.");
        } else {
            generate_path_field(child, schema.properties[child], depth + 1, output, true, "_fluent_classes.");
        }
    }


    //generate public classes inside the root scope, but within another static class so the IDE doesn't drown in option
    writeLine("public static class _fluent_classes {", depth, output);
        generate_path_class("root", schema, 2, output);
    writeLine("}", depth, output);

    writeLine(PREAMBLE, 0, output);

    generate_root_buildValue(schema, depth + 1, output);
    writeLine("}", depth, output);
}
function generate_path_class(name: string, schema: schema.SchemaNode, depth: number, output: string[]) {
    var primitive: PlanElement = generateStepBuilder(name, schema, depth, output);
    generateValue(name, schema, depth, output);

    if (primitive) {
        writeLine("public static class " + pathClassIdentifier(schema) + " {", depth, output);
    } else {
        writeLine("public static class " + pathClassIdentifier(schema) + " extends Ref<" + builderClassIdentifier(schema) + "0" + "> {", depth, output);
        generateRefConstructor(name, schema, depth + 1, output);
    }

    //for each non-wildchild child we generate a field to an instantiated child path_class
    //for wildchilds we create a function that instantiates the correct child path class
    var wildchild_key = null;

    for (var child in schema.properties) {
        if (child.indexOf("$") == 0 || child.indexOf("~$") == 0) {
            wildchild_key = child;
            generate_path_wild_function(child, schema.properties[child], depth + 1, output);
        } else {
            generate_path_field(child, schema.properties[child], depth + 1, output);
        }
    }

    if (primitive == null) {
        generate_buildValue(name, schema, depth + 1, output);

    } else {
        generate_primitiveWrite(primitive, output);
    }

    writeLine("}", depth, output);

    for (var child in schema.properties) {
        generate_path_class(child, schema.properties[child], depth, output);
    }
}

/**
 * The complicated bit. The process of building a value is a series of typed steps which force a valid object to have all required fields specified before writing is allowed
 * @param name
 * @param schema
 * @param depth
 * @param output
 * @return is non-null if that plan was a single primative invocation, therefore the parent should not generate a buildObject
 */
function generateStepBuilder(name: string, schema: schema.SchemaNode, depth: number, output: string[]): PlanElement {
    //so first step is to work out the sequence if the user specifies every optional field
    //they specify the primitives, dropping into sub builders for complex objects,
    //wildchilds can be added multiple times by using a keyed subbuilder todo
    //the ordering is basically an inorder traversal of the schema node's properties
    var plan: PlanElement[] = [];
    planStepBuilderTop(name, schema, 0, plan);

    if (DEBUG) {
        for(var i =0; i < plan.length; i++) {
            writeLine("//" + plan[i].toString(), plan[i].depth, output);
        }
    }

    //second step is generating the classes based on the plan
    //for each step we check to see if we could skip ahead because the field was optional
    for(var i =0; i < plan.length; i++) {
        var p: PlanElement = plan[i];

        p.generatePlanStep(i, plan, output);
    }

    if (plan.length == 1) return plan[0];
}

function generateValue(name: string, schema: schema.SchemaNode, depth: number, output: string[]) {
    var classname = valueClassIdentifier(schema);
    writeLine("public static class " + classname + " extends Val {", depth, output);
    writeLine("  " + classname + "(SubBuilder prev) {", depth, output);
    writeLine("    super(prev);", depth, output);
    writeLine("  }", depth, output);
    writeLine("}", depth, output);
}

class PlanElement {
    static FIRST = "first";
    static LAST  = "last ";
    static START = "start";
    static END   = "end  ";
    static PRIMITIVE   = "prim ";
    static SINGLE_PRIM = "singl";
    constructor(public type: String, public rootSchema: schema.SchemaNode, public schema: schema.SchemaNode, public depth: number, public required: Boolean = true) {}
    toString() {
        return this.type + ": " + this.schema.key
    }

    generatePlanStep(index: number, plan: PlanElement[], output: string[]) {
        var className = builderClassIdentifier(this.rootSchema) + index;
        if (this.type == PlanElement.FIRST) {
            writeLine("public static class " + className + " extends SubBuilderIdentity {", 0, output);//constructor
            writeLine(className + "(Ref ref) {", 1, output);
            writeLine("  super(ref, null);", 1, output);
            writeLine("}", 1, output);
            this.generateTransitions(index, plan, output);

            writeLine("}", 0, output);
        } else if (this.type == PlanElement.LAST) {
            var valueReturnType = valueClassIdentifier(this.schema);
            writeLine("public static class " + className + " extends SubBuilderLast<" + valueReturnType + "> {", 0, output);seperator(output);
            //constructor
            writeLine(className + "(SubBuilder prev) {", 1, output);
            writeLine("  super(null, prev);", 1, output);
            writeLine("}", 1, output);
            this.generateValue(valueReturnType, output);

            writeLine("}", 0, output);
        } else if (this.type == PlanElement.START) {
            writeLine("public static class " + className + " extends SubBuilderIdentity {", 0, output);//constructor
            writeLine(className + "(SubBuilder parent) {", 1, output);
            writeLine("  super(parent.ref, parent);", 1, output);
            writeLine("}", 1, output);
            this.generateTransitions(index, plan, output);

            writeLine("}", 0, output);
        } else if (this.type == PlanElement.END) {
            var valueReturnType = valueClassIdentifier(this.rootSchema);
            writeLine("public static class " + className + " extends SubBuilderLast<" + valueReturnType + "> {", 0, output);seperator(output);
            //constructor
            writeLine(className + "(SubBuilder parent, SubBuilder prev) {", 1, output);
            writeLine("  super(parent, prev);", 1, output);
            writeLine("}", 1, output);
            this.generateSubValue(valueReturnType, output);

            writeLine("}", 0, output);
        } else if (this.type == PlanElement.PRIMITIVE) {
            //constructor
            writeLine("public static class " + className + " extends SubBuilderIntermediate {", 0, output);
            writeLine(className + "(SubBuilder parent, SubBuilder prev, String key, Object val) {", 1, output);
            writeLine("  super(parent, prev, key, val);", 1, output);
            writeLine("}", 1, output);
            this.generateTransitions(index, plan, output);

            writeLine("}", 0, output);
        }
    }

    generateValue(returnType: string, output: string[]) {
        writeLine("public " + returnType + " value() {", 1, output);
        writeLine("  return new " + returnType + "(this);", 1, output);
        writeLine("}", 1, output);
    }
    generateSubValue(returnType: string, output: string[]) {
        writeLine("public " + returnType + " write() {", 1, output);
        writeLine("  return new " + returnType + "(this);", 1, output);
        writeLine("}", 1, output);
    }
    generateTransitions(index: number, plan: PlanElement[], output: string[]) {
        for (var i = index + 1; i < plan.length; i++) {
            var futurePlanElement: PlanElement = plan[i];

            if (futurePlanElement.type == PlanElement.PRIMITIVE) {
                var functionname = camelConcatinate("set", futurePlanElement.schema.key);
                var returnType   = builderClassIdentifier(futurePlanElement.rootSchema) + i;
                var types = schemaToJavaTypes(futurePlanElement.schema);

                for (var t = 0; t < types.length; t++) {
                    var type: string = types[t];
                    writeLine("public " + returnType + " " + functionname + "(" + type + " val) {", 1, output);
                    writeLine("  return new " + returnType + "(parent.parent, parent, \"" + futurePlanElement.schema.key + "\", val);", 1, output);
                    writeLine("}", 1, output);
                }
            }
            if (futurePlanElement.type == PlanElement.LAST) {
                var returnType   = valueClassIdentifier(futurePlanElement.rootSchema);
                writeLine("public " + returnType + " " + "write() {", 1, output);
                writeLine("  return new " + returnType + "(parent.parent);", 1, output);
                writeLine("}", 1, output);
            }
            if (futurePlanElement.type == PlanElement.END) {
                var returnType   = builderClassIdentifier(futurePlanElement.rootSchema) + i;
                var functionname = camelConcatinate("close", futurePlanElement.schema.key);
                writeLine("public " + returnType + " " + functionname + "() {", 1, output);
                writeLine("  return new " + returnType + "(parent.parent, parent);", 1, output);
                writeLine("}", 1, output);
            }
            if (futurePlanElement.type == PlanElement.START && futurePlanElement.schema.key.indexOf("$") != 0) {
                var functionname = camelConcatinate("open", futurePlanElement.schema.key);
                var returnType   = builderClassIdentifier(futurePlanElement.rootSchema) + i;
                writeLine("public " + returnType + " " + functionname + "() {", 1, output);
                writeLine("  return new " + returnType + "(this);", 1, output);
                writeLine("}", 1, output);
            }

            if (futurePlanElement.required) break; //we quit if we have to step to the next one
            if (futurePlanElement.type == PlanElement.FIRST) break;  //we quit if we have to go up a level of context
            if (futurePlanElement.type == PlanElement.END) break;  //we quit if we have to go up a level of context
            if (futurePlanElement.type == PlanElement.LAST) break; //we quit if we have to go up a level of context

            //if a non required new context is following, we can skip it by fast forwarding to after
            if (futurePlanElement.type == PlanElement.START) {
                while (plan[i].type != PlanElement.END) i++;
            }
        }
    }
}


function generate_primitiveWrite(primitive: PlanElement, output: string[]) {
    var functionname = "write";
    var types = schemaToJavaTypes(primitive.schema);
    for (var t = 0; t < types.length; t++) {
        var type: string = types[t];
        writeLine("public void " + functionname + "(" + type + " val) {", 1, output);
        //todo implementation
        writeLine("}", 1, output);
    }

}

function planStepBuilderTop(name: string, rootSchema: schema.SchemaNode, depth: number, plan: PlanElement[]) {
    planStepBuilder(name, rootSchema, rootSchema, depth, plan);
    if (plan[0].type == PlanElement.START){
        plan[0].type = PlanElement.FIRST;
        plan[plan.length - 1].type = PlanElement.LAST;
    } else {
        //not a complex object
        plan[0].type = PlanElement.SINGLE_PRIM;
    }
}

function planStepBuilder(name: string, rootSchema: schema.SchemaNode, schema: schema.SchemaNode, depth: number, plan: PlanElement[]) {
    var requiredArray: string[] = schema.parent == null ? [] : schema.parent.required.toJSON();
    var required: boolean = requiredArray.indexOf(name) >= 0;

    if (schema.type == "any" || schema.type == "object") {
        plan.push(new PlanElement(PlanElement.START, rootSchema, schema, depth, required));
        for (var child in schema.properties) {
            planStepBuilder(child, rootSchema, schema.properties[child], depth + 1, plan);
        }
        plan.push(new PlanElement(PlanElement.END, rootSchema, schema, depth));
    } else if (schema.type == "string" || schema.type == "number") {
        plan.push(new PlanElement(PlanElement.PRIMITIVE, rootSchema, schema, depth, required));
    } else {
        throw new Error("unrecognised type in schema: " + schema.type);
    }
}