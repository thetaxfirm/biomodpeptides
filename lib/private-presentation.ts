// Used only by server response projections. Original submissions and ledgers remain intact.
const withdrawnText = /\b(?:glp[a-z0-9]*(?:[- ]?\d)?|retatr[a-z]*|tirzep[a-z]*|cagril[a-z]*|sem[ai]gl[a-z]*|c[- ]heat(?:[- ]s)?|heat[- ][rt](?:[- ]?(?:20|30)\s*mg)?|cag|sema|reta|tirz)\b|2381089-83-2|2023788-19-2|1415456-99-3|910463-68-2/gi;
export const presentationText = (text: string) => text.replace(withdrawnText, 'Archived product');
export function presentationData(value: any): any {
  if (typeof value === 'string') return presentationText(value);
  if (Array.isArray(value)) return value.map(presentationData);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, presentationData(item)]));
  return value;
}
