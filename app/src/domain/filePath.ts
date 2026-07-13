export function fileNameFromPath(path: string): string {
    return path.split(/[\\/]/).pop() || path;
}
