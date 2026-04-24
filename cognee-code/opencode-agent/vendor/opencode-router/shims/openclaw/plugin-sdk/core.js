export function emptyPluginConfigSchema() {
  return {
    safeParse(value) {
      if (value === undefined) {
        return { success: true, data: undefined }
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { success: false, error: { issues: [{ path: [], message: "expected config object" }] } }
      }
      if (Object.keys(value).length > 0) {
        return { success: false, error: { issues: [{ path: [], message: "config must be empty" }] } }
      }
      return { success: true, data: value }
    },
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  }
}
