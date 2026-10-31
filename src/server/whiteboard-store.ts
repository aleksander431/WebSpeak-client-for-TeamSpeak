import type { WebSpeakDatabase } from "../persistence/database.js";
import { parseWhiteboardElement, type WhiteboardElement, type WhiteboardSheet } from "../shared/whiteboard.js";

/** Where boards live. The gateway uses SQLite; relays and tests keep them in memory. */
export interface WhiteboardStore {
  listSheets(boardKey: string): WhiteboardSheet[];
  createSheet(boardKey: string, sheet: WhiteboardSheet): void;
  renameSheet(boardKey: string, sheetId: string, name: string): boolean;
  deleteSheet(boardKey: string, sheetId: string): boolean;
  loadElements(boardKey: string, sheetId: string): WhiteboardElement[];
  saveElements(boardKey: string, sheetId: string, elements: readonly WhiteboardElement[]): void;
  deleteElements(boardKey: string, sheetId: string, ids: readonly string[]): void;
  clearSheet(boardKey: string, sheetId: string): void;
}

export class SqliteWhiteboardStore implements WhiteboardStore {
  constructor(private readonly database: WebSpeakDatabase) {}
  listSheets(boardKey: string) { return this.database.listWhiteboardSheets(boardKey); }
  createSheet(boardKey: string, sheet: WhiteboardSheet) { this.database.createWhiteboardSheet(boardKey, sheet); }
  renameSheet(boardKey: string, sheetId: string, name: string) { return this.database.renameWhiteboardSheet(boardKey, sheetId, name); }
  deleteSheet(boardKey: string, sheetId: string) { return this.database.deleteWhiteboardSheet(boardKey, sheetId); }
  loadElements(boardKey: string, sheetId: string) {
    // Stored rows are re-validated so a damaged row cannot reach browsers.
    return this.database.loadWhiteboardElements(boardKey, sheetId).flatMap((data) => {
      try {
        const element = parseWhiteboardElement(JSON.parse(data));
        return element ? [element] : [];
      } catch {
        return [];
      }
    });
  }
  saveElements(boardKey: string, sheetId: string, elements: readonly WhiteboardElement[]) {
    this.database.saveWhiteboardElements(boardKey, sheetId, elements.map((element) => ({ id: element.id, data: JSON.stringify(element) })));
  }
  deleteElements(boardKey: string, sheetId: string, ids: readonly string[]) { this.database.deleteWhiteboardElements(boardKey, sheetId, ids); }
  clearSheet(boardKey: string, sheetId: string) { this.database.clearWhiteboardSheet(boardKey, sheetId); }
}

export class MemoryWhiteboardStore implements WhiteboardStore {
  private readonly sheets = new Map<string, WhiteboardSheet[]>();
  private readonly elements = new Map<string, Map<string, WhiteboardElement>>();
  private key(boardKey: string, sheetId: string) { return `${boardKey}\u0000${sheetId}`; }
  listSheets(boardKey: string) { return [...(this.sheets.get(boardKey) ?? [])]; }
  createSheet(boardKey: string, sheet: WhiteboardSheet) { this.sheets.set(boardKey, [...this.listSheets(boardKey), { ...sheet }]); }
  renameSheet(boardKey: string, sheetId: string, name: string) {
    const sheet = this.sheets.get(boardKey)?.find((candidate) => candidate.id === sheetId);
    if (!sheet) return false;
    sheet.name = name;
    return true;
  }
  deleteSheet(boardKey: string, sheetId: string) {
    const sheets = this.listSheets(boardKey);
    const next = sheets.filter((sheet) => sheet.id !== sheetId);
    this.sheets.set(boardKey, next);
    this.elements.delete(this.key(boardKey, sheetId));
    return next.length !== sheets.length;
  }
  loadElements(boardKey: string, sheetId: string) { return [...(this.elements.get(this.key(boardKey, sheetId))?.values() ?? [])].map((element) => ({ ...element })); }
  saveElements(boardKey: string, sheetId: string, elements: readonly WhiteboardElement[]) {
    const key = this.key(boardKey, sheetId);
    const map = this.elements.get(key) ?? new Map<string, WhiteboardElement>();
    for (const element of elements) map.set(element.id, { ...element });
    this.elements.set(key, map);
  }
  deleteElements(boardKey: string, sheetId: string, ids: readonly string[]) {
    const map = this.elements.get(this.key(boardKey, sheetId));
    for (const id of ids) map?.delete(id);
  }
  clearSheet(boardKey: string, sheetId: string) { this.elements.delete(this.key(boardKey, sheetId)); }
}
