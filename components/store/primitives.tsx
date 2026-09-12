'use client';
import { ReactNode } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
export function Choice({ value, onChange, options, label }: {
    value: string;
    onChange: (v: string) => void;
    options: [
        string,
        string
    ][];
    label: string;
}) { return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label} className="choice"><SelectValue /></SelectTrigger><SelectContent>{options.map(([v, t]) => <SelectItem value={v} key={v}>{t}</SelectItem>)}</SelectContent></Select>; }
export function Check({ checked, onChange, children }: {
    checked: boolean;
    onChange: (v: boolean) => void;
    children: ReactNode;
}) { return <label className="check"><Checkbox checked={checked} onCheckedChange={v => onChange(v === true)}/><span>{children}</span></label>; }
export function Blank({ title, children }: {
    title: string;
    children?: ReactNode;
}) { return <Empty className="blank"><EmptyHeader><EmptyTitle>{title}</EmptyTitle></EmptyHeader><div className="blank-description">{children}</div></Empty>; }
export function Field({ label, name, type = 'text', required = true, defaultValue, placeholder, step, children }: {
    label: string;
    name: string;
    type?: string;
    required?: boolean;
    defaultValue?: string;
    placeholder?: string;
    step?: number | string;
    children?: ReactNode;
}) { return <label className="field"><span>{label}</span>{children || <input name={name} type={type} required={required} defaultValue={defaultValue} placeholder={placeholder} step={step}/>}</label>; }
export const formData = (form: HTMLFormElement) => Object.fromEntries(new FormData(form));
