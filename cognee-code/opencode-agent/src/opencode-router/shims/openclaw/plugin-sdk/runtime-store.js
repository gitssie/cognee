export function createPluginRuntimeStore(errorMessage) {
  let runtime = null

  return {
    setRuntime(next) {
      runtime = next
    },
    clearRuntime() {
      runtime = null
    },
    tryGetRuntime() {
      return runtime
    },
    getRuntime() {
      if (!runtime) {
        throw new Error(errorMessage)
      }
      return runtime
    },
  }
}
