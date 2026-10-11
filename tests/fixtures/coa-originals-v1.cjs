// Explicitly synthetic, non-laboratory PDF fixtures. Never use these as customer reports.
const {createHash}=require('node:crypto');
const inputs=[{productId:745,productName:'HEAT-R 30mg',strength:'30mg',lot:'102-30-0001'},
 {productId:1389,productName:'HEAT-R 20mg',strength:'20mg',lot:'102-20-0001'},
 {productId:747,productName:'C-HEAT',strength:'10mg',lot:'104-10-0001'}];
module.exports={schemaVersion:1,reports:inputs.map((input,index)=>{
 const bytes=Buffer.from('%PDF-1.4\n% SYNTHETIC AUTOMATION TEST ONLY - NOT A LABORATORY REPORT '+index+'\n%%EOF\n');
 return {...input,form:'lyophilized powder',reportId:'SYNTHETIC-TEST-'+index,filename:'synthetic-fixture-'+index+'.pdf',
 sha256:createHash('sha256').update(bytes).digest('hex'),base64:bytes.toString('base64'),chemicalIdentity:'SYNTHETIC TEST IDENTITY '+index,sourceBasename:'synthetic-fixture-'+index+'.pdf'};
})};
