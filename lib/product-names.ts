// Other spellings people search for, per eligible product listing. Only pure spelling
// variants, or a name the catalog itself states as the compound (catalog-facts-v2.json).
// Never add a different compound, a blend name or a held product here.
export const productNameVariants: Record<string, string[]> = {
  'mots-c-10mg': ['MOTSc', 'MOTS c'],
  'mots-c-40mg': ['MOTSc', 'MOTS c'],
  'ss-31-10mg': ['SS31', 'SS 31'],
  'ss-31-50mg': ['SS31', 'SS 31'],
  'epitalon-50mg': ['Epithalon'],
  'aod-9604-10mg': ['AOD-9604', 'AOD9604'],
  'dsip-10mg': ['delta sleep-inducing peptide'],
  'kisspeptin-10mg': ['Kisspeptin-10', 'Kisspeptin 10'], // its own question: plain kisspeptin is broader
  'pt-141-10mg': ['PT141', 'PT 141'],
  'thymosin-alpha-1-10mg': ['Thymosin Alpha 1', 'TA1'],
};
