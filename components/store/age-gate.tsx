'use client';
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
export function AgeGate() { const [open, setOpen] = useState(false); const [under, setUnder] = useState(false); useEffect(() => { try {
    setOpen(localStorage.getItem('biomod-age-21') !== 'confirmed');
}
catch {
    setOpen(true);
} }, []); return <Dialog open={open}><DialogContent className="age-dialog" showCloseButton={false} onEscapeKeyDown={e => e.preventDefault()} onInteractOutside={e => e.preventDefault()}><img src="/brand/logo-navy-v3.svg" alt="BIOMOD Peptides" width={220}/><DialogTitle>{under ? 'This store is for adults age 21+.' : 'Research use only. Age 21+.'}</DialogTitle><DialogDescription>{under ? 'Please return when you meet the age requirement.' : 'Biomod supplies laboratory research products. They are not for human or animal use. Confirm your age to enter the store.'}</DialogDescription>{!under && <><button className="button button-dark" onClick={() => { try {
    localStorage.setItem('biomod-age-21', 'confirmed');
}
catch { } setOpen(false); }}>I am 21 or older</button><button className="text-button" onClick={() => setUnder(true)}>I am under 21</button></>}{under && <button className="text-button" onClick={() => setUnder(false)}>Back</button>}</DialogContent></Dialog>; }
