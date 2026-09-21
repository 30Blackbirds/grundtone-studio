export declare const VERSION_FILE: RegExp
export declare const REQUIRED_EXTS: string[]
export declare function checkContract(input: {
  current: Map<string, Buffer>
  base: Map<string, Buffer>
  contractVersion: string
}): string[]
