import type {CodeKeywordDefinition, AnySchemaObject, KeywordCxt, Code, Name} from "ajv"
import type {DefinitionOptions} from "./_types"
import {_, stringify, getProperty} from "ajv/dist/compile/codegen"

type TransformationName =
  | "trimStart"
  | "trimEnd"
  | "trimLeft"
  | "trimRight"
  | "trim"
  | "toLowerCase"
  | "toUpperCase"
  | "toEnumCase"

interface TransformConfig {
  hash: Record<string, string | undefined>
}

export type Transformation = (s: string, cfg?: TransformConfig) => string

const builtInTransformations: {[key in TransformationName]: Transformation} = {
  trimStart: (s) => s.trimStart(),
  trimEnd: (s) => s.trimEnd(),
  trimLeft: (s) => s.trimStart(),
  trimRight: (s) => s.trimEnd(),
  trim: (s) => s.trim(),
  toLowerCase: (s) => s.toLowerCase(),
  toUpperCase: (s) => s.toUpperCase(),
  toEnumCase: (s, cfg) => cfg?.hash[configKey(s)] || s,
}

function getDef(opts?: DefinitionOptions): CodeKeywordDefinition {
  const customTransformations = opts?.transform || {}
  const availableTransformations = [
    ...Object.keys(builtInTransformations),
    ...Object.keys(customTransformations),
  ]

  return {
    keyword: "transform",
    schemaType: "array",
    before: "enum",
    code(cxt: KeywordCxt) {
      const {gen, data, schema, parentSchema, it} = cxt
      const {parentData, parentDataProperty} = it
      const tNames: string[] = schema
      if (!tNames.length) return
      let cfg: Name | undefined
      if (tNames.includes("toEnumCase")) {
        const config = getEnumCaseCfg(parentSchema)
        cfg = gen.scopeValue("obj", {ref: config, code: stringify(config)})
      }
      gen.if(_`typeof ${data} == "string" && ${parentData} !== undefined`, () => {
        gen.assign(data, transformExpr(tNames.slice()))
        gen.assign(_`${parentData}[${parentDataProperty}]`, data)
      })

      function transformExpr(ts: string[]): Code {
        if (!ts.length) return data
        const t = ts.pop() as TransformationName | string
        if (!availableTransformations.includes(t)) {
          throw new Error(`transform: unknown transformation ${t}`)
        }

        const func = gen.scopeValue(
          "func",
          customTransformations[t] // eslint-disable-line @typescript-eslint/no-unnecessary-condition
            ? {
                ref: customTransformations[t].transformation,
                code: _`require("${customTransformations[t].modulePath}")${getProperty(t)}`,
              }
            : {
                ref: builtInTransformations[t as TransformationName],
                code: _`require("ajv-keywords/dist/definitions/transform").transform${getProperty(
                  t
                )}`,
              }
        )
        const arg = transformExpr(ts)
        return cfg && t === "toEnumCase" ? _`${func}(${arg}, ${cfg})` : _`${func}(${arg})`
      }
    },
    metaSchema: {
      type: "array",
      items: {type: "string", enum: availableTransformations},
    },
  }
}

function getEnumCaseCfg(parentSchema: AnySchemaObject): TransformConfig {
  // build hash table to enum values
  const cfg: TransformConfig = {hash: {}}

  // requires `enum` in the same schema as transform
  if (!parentSchema.enum) throw new Error('transform: "toEnumCase" requires "enum"')
  for (const v of parentSchema.enum) {
    if (typeof v !== "string") continue
    const k = configKey(v)
    // requires all `enum` values have unique keys
    if (cfg.hash[k]) {
      throw new Error('transform: "toEnumCase" requires all lowercased "enum" values to be unique')
    }
    cfg.hash[k] = v
  }

  return cfg
}

function configKey(s: string): string {
  return s.toLowerCase()
}

export default getDef
module.exports = getDef
