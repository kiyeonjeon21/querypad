import * as XLSX from "xlsx";

export function xlsxToCsv(buffer: Uint8Array): Uint8Array {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const csv = XLSX.utils.sheet_to_csv(sheet);
  return new TextEncoder().encode(csv);
}
