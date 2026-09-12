// Formulation amounts transcribed from BIOMOD's supplied label files and original
// package artwork. The owner corrected the shell to gelatin on September 6, 2026.
// No human-use instructions or superseded label files are delivered by this module.
export type SoftgelDetails = {
  compounds: { name: string; amount: string }[];
  fillDocumented: boolean;
};

export const softgelDetails: Record<number, SoftgelDetails> = {
  779: { compounds: [{ name: 'Methylene Blue USP', amount: '12.5 mg' }], fillDocumented: true },
  776: { compounds: [{ name: 'BPC-157 Arginate', amount: '750 mcg' }, { name: 'KPV', amount: '1000 mcg' }, { name: 'Vitamin E', amount: '5 mg' }], fillDocumented: true },
  777: { compounds: [{ name: 'GHK-Cu', amount: '5 mg' }, { name: 'AHK-Cu', amount: '2.5 mg' }, { name: 'Astaxanthin', amount: 'Confirm current amount' }, { name: 'Vitamin E', amount: '7.5 mg' }], fillDocumented: true },
  778: { compounds: [{ name: 'O-304 (ATX-304)', amount: '50 mg' }], fillDocumented: true },
  780: { compounds: [{ name: 'Dihexa', amount: '30 mg' }, { name: 'J-147', amount: '10 mg' }], fillDocumented: false },
  781: { compounds: [{ name: 'Pinealon', amount: '1 mg' }, { name: 'Epitalon', amount: '2.5 mg' }], fillDocumented: true },
  782: { compounds: [{ name: 'AOD 9604', amount: '500 mcg' }], fillDocumented: false },
  852: { compounds: [{ name: 'Tesofensine', amount: '0.5 mg' }], fillDocumented: true },
};
