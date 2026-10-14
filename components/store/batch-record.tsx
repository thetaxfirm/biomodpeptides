'use client';
import { useState } from 'react';
import { FileText, ArrowUpRight, Copy, QrCode, Download } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableRow, TableHead, TableHeader, TableCell } from '@/components/ui/table';
import { coaOnRequest, coaRequestNoticeFor, batchFor, batchStatus, batchStatusLabel, matchingCertificateFor, reportedResult, batchPath, statusLabels } from '@/lib/testing';
import { Product, compound, productFormat } from '@/lib/catalog';
import { Choice } from './primitives';
import { report } from './provider';
import { toast } from 'sonner';
import styles from './batch-record.module.css';
/** "Request by email": the store emails a private link to the original COA right away. */
export function CoaEmailRequest({record:r}:{record:any}){
 const [email,setEmail]=useState('');const [state,setState]=useState<'idle'|'sending'|'sent'|'error'>('idle');const [message,setMessage]=useState('');
 async function send(e:React.FormEvent){e.preventDefault();if(state==='sending')return;setState('sending');setMessage('');
  try{const res=await fetch('/api/coa-link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:r.product_id,email})});const d:any=await res.json().catch(()=>({}));
   if(!res.ok)throw new Error(d.error||'The COA could not be sent. Try again.');setState('sent');setMessage(d.message||'Sent. Check your email.');}
  catch(err){setState('error');setMessage(err instanceof Error?err.message:'The COA could not be sent. Try again.');}}
 if(state==='sent')return <p className={styles.coaSent} role="status">{message}</p>;
 return <form className={styles.coaEmail} onSubmit={send}><label htmlFor={'coa-email-'+r.product_id}>Request by email</label><div><input id={'coa-email-'+r.product_id} type="email" required autoComplete="email" inputMode="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} disabled={state==='sending'}/><button type="submit" className="button button-dark" disabled={state==='sending'}>{state==='sending'?'Sending…':'Send me the COA'}</button></div><small>We email you a link to the original COA for lot {r.product_lot||'in stock'} right away.</small>{state==='error'&&<p className={styles.coaError} role="alert">{message}</p>}</form>;
}
export function CertificateButton({record:r}:{record:any}){
 const d=matchingCertificateFor(r);const [open,setOpen]=useState(false);const [page,setPage]=useState(1);const [zoom,setZoom]=useState('100');if(coaOnRequest(r))return <div className="coa-request" style={{flexBasis:'100%'}}><p style={{marginBottom:12}}>{coaRequestNoticeFor(r)}</p><CoaEmailRequest record={r}/></div>;if(!d)return null;
 return <><button className="document-button" onClick={()=>setOpen(true)}><FileText size={18}/>Read original certificate <ArrowUpRight size={16}/></button><a href={d.url} target="_blank" rel="noopener noreferrer">Open original PDF <ArrowUpRight size={16}/></a><Dialog open={open} onOpenChange={setOpen}><DialogContent className={"coa-dialog "+styles.certificateDialog}><DialogTitle>{r.product_name} · Original certificate</DialogTitle><DialogDescription>Certificate lot: {d.batch_number||'Not listed'}. {d.report_date?'Reported '+d.report_date:d.release_date?'Released '+d.release_date:''}</DialogDescription><div className={"document-actions "+styles.documentActions}><label>Page <input aria-label="PDF page" type="number" min={1} value={page} onChange={e=>setPage(Math.max(1,Number(e.target.value)||1))}/></label><Choice label="PDF zoom" value={zoom} onChange={setZoom} options={[["75","75%"],["100","100%"],["125","125%"],["150","150%"]]}/><a href={d.url} target="_blank" rel="noopener noreferrer">Open / download PDF <ArrowUpRight size={16}/></a></div><iframe className="pdf-view" key={page+zoom} src={d.url+'#page='+page+'&zoom='+zoom} title={r.product_name+' certificate'}/><details><summary>Read extracted results and methods</summary><div className={"document-results "+styles.documentResults} role="region" aria-label="Extracted certificate results and methods" tabIndex={0}><Table><TableHeader><TableRow><TableHead>Test</TableHead><TableHead>Reported result</TableHead><TableHead>Method</TableHead></TableRow></TableHeader><TableBody>{d.results.map((v:any,i:number)=><TableRow key={i}><TableCell>{v.analyte}</TableCell><TableCell>{v.result}{v.unit&&!v.result.includes(v.unit)?' '+v.unit:''}{d.report_scope_notes&&v.loq&&<small className="muted" style={{display:'block'}}>LOQ: {v.loq} {v.unit}</small>}</TableCell><TableCell>{v.method||'Not reported'}</TableCell></TableRow>)}</TableBody></Table></div>{d.report_scope_notes?.map((note:string,i:number)=><p className="muted" key={i}>{note}</p>)}</details><p className="muted">If the embedded document does not load, use the original PDF link.</p></DialogContent></Dialog></>;
}
export function BatchDetails({record:r}:{record:any}){
 const d=matchingCertificateFor(r);const [qr,setQr]=useState(''),[qrOpen,setQrOpen]=useState(false),[qrBusy,setQrBusy]=useState(false);
 const url=()=>window.location.origin+batchPath(r);
 async function makeQr(){setQrBusy(true);try{const code=await import('qrcode');setQr(await code.toDataURL(url(),{width:360,margin:4,errorCorrectionLevel:'M',color:{dark:'#242220',light:'#ffffff'}}));setQrOpen(true);}catch(e){report(e);}finally{setQrBusy(false);}}
 if(coaOnRequest(r))return <div className="batch-details"><div className="batch-facts"><dl><dt>Lot</dt><dd>{r.product_lot||statusLabels.pending}</dd></dl></div><div className="batch-actions"><CertificateButton record={r}/></div></div>;
 const facts=d?<><dl><dt>Lot</dt><dd>{r.product_lot}</dd></dl><dl><dt>Report lot</dt><dd>{d.batch_number}</dd></dl><dl><dt>Report date</dt><dd>{d.report_date||d.release_date||d.issue_date||'See report'}</dd></dl><dl><dt>Purity</dt><dd>{reportedResult(d,'purity')}</dd></dl><dl><dt>Measured content</dt><dd>{reportedResult(d,'assay')}</dd></dl><dl><dt>Report reference</dt><dd>{d.report_id||'See report'}</dd></dl></>:<dl><dt>Lot</dt><dd>{r.product_lot||statusLabels.pending}</dd></dl>;
 return <div className="batch-details"><div className="batch-facts">{facts}</div>{d&&r.certificate_source_note&&<p className="batch-explanation">{r.certificate_source_note}{r.recorded_on&&' Record updated '+r.recorded_on+'.'}</p>}{!d&&<p className="batch-explanation">The lab report for this lot is being updated. Ask us anytime for the latest documentation.</p>}<div className="batch-actions"><CertificateButton record={r}/><button className="text-button" onClick={()=>navigator.clipboard.writeText(url()).then(()=>toast.success('Batch record link copied.')).catch(report)}><Copy size={16}/>Copy record link</button><button className="text-button" disabled={qrBusy} onClick={makeQr}><QrCode size={16}/>{qrBusy?'Creating code…':'QR code'}</button><a href={'/contact?subject='+encodeURIComponent('Documentation: '+r.product_name+(r.product_lot?' / '+r.product_lot:''))}>Ask about this lot <ArrowUpRight size={16}/></a></div><Dialog open={qrOpen} onOpenChange={setQrOpen}><DialogContent className="qr-dialog"><DialogTitle>{r.product_name} · Batch record</DialogTitle><DialogDescription>Scan to open this record. Lot: {r.product_lot||statusLabels.pending}.</DialogDescription>{qr&&<img src={qr} alt={'QR code for '+r.product_name+' batch record'} width={280} height={280}/>}<a className="button button-dark" href={qr} download={'biomod-'+r.record_id+'-qr-v1.png'}><Download size={17}/>Download QR code</a></DialogContent></Dialog></div>;
}
export function BatchPassport({product:p}:{product:Product}){const r=batchFor(p.id,p);if(!r)return null;return <section className="batch-passport"><div className="batch-passport-heading"><div><h2>Product & batch record</h2><p>{compound(p)} · {productFormat(p)}</p></div><span className={'batch-status '+batchStatus(r)}>{batchStatusLabel(r)}</span></div><BatchDetails record={r}/>{r.product_lot&&<p className="batch-source-note">{matchingCertificateFor(r)&&r.recorded_on ? 'Record updated ' + r.recorded_on + '. ' : ''}Match this lot to the label on your vial.</p>}</section>}

/** Product page: the lot, its COA and "email me the COA" in a popup, so the customer never leaves the product. */
export function CoaPopup({product:p,label='View COA and testing',className='coa-link'}:{product:Product;label?:string;className?:string}){
 const [open,setOpen]=useState(false);const r=batchFor(p.id,p);
 if(!r)return null;
 return <><button type="button" className={className+' '+styles.popupButton} onClick={()=>setOpen(true)}>{label} <ArrowUpRight size={17}/></button>
  <Dialog open={open} onOpenChange={setOpen}><DialogContent className={'coa-dialog '+styles.coaPopup}>
   <DialogTitle>{p.name} · COA and testing</DialogTitle>
   <DialogDescription>{batchStatusLabel(r)}{r.product_lot?' · Lot '+r.product_lot:''}</DialogDescription>
   <BatchDetails record={r}/>
  </DialogContent></Dialog></>;
}
