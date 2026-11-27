import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
type Report = { indexingEnabled: boolean; canonicalOrigin: string; launchApproved: boolean; originConfigured: boolean; reviewedOn: string; sitemapCount: number; productMarkup: string; products: { name: string; slug: string; eligible: boolean; reason: string }[] };
export function SearchPublishing({ report }: { report: Report }) {
  const waiting=report.products.filter(p=>!p.eligible);
  return <section className="seo-report">
    <h2>Search publishing</h2>
    <p className="notice">{report.indexingEnabled ? 'Public search indexing is enabled for eligible pages.' : 'Public search indexing is paused.'} Private customer pages and filtered URLs stay out of the sitemap.</p>
    <div className="seo-summary"><div>Production website<strong>{report.canonicalOrigin}</strong></div><div>Sitemap pages<strong>{report.sitemapCount}</strong></div><div>Products approved for indexing<strong>{report.products.length-waiting.length} / {report.products.length}</strong></div></div>
    <h3>Next actions</h3>
    <Table><TableHeader><TableRow><TableHead>Action</TableHead><TableHead>Responsible team</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>
      <TableRow><TableCell>Confirm the production hostname</TableCell><TableCell>Website owner</TableCell><TableCell>{report.originConfigured?'Complete':'Needs confirmation'}</TableCell></TableRow>
      <TableRow><TableCell>Approve public publication</TableCell><TableCell>Website owner</TableCell><TableCell>{report.launchApproved?'Approval recorded':'Awaiting approval'}</TableCell></TableRow>
      <TableRow><TableCell>Review product identity, packaging, intended use and wording</TableCell><TableCell>Catalog team and owner</TableCell><TableCell>{waiting.length?`${waiting.length} products awaiting review`:'All listed products reviewed'}</TableCell></TableRow>
      <TableRow><TableCell>Confirm suite and visiting details before publishing location pages</TableCell><TableCell>Website owner</TableCell><TableCell>Locations remain outside the sitemap</TableCell></TableRow>
    </TableBody></Table>
    <p>Use the product links below to review the current record. Submit approved wording or document changes through <a href="/admin?tab=updates">Website updates</a>. A publication hold must be reviewed before it can be released.</p>
    <h3>Product publication review</h3>
    <Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Status</TableHead><TableHead>Review note</TableHead></TableRow></TableHeader><TableBody>{report.products.map(p=><TableRow key={p.slug}><TableCell><a href={'/admin?tab=products&product='+encodeURIComponent(p.slug)}>{p.name}</a></TableCell><TableCell>{p.eligible?'Approved for indexing':'Review required'}</TableCell><TableCell>{p.reason}</TableCell></TableRow>)}</TableBody></Table>
    <details><summary>Technical publication controls and policy references</summary><p>Configure <code>SEO_PUBLIC_ORIGIN</code>, <code>SEO_PUBLIC_LAUNCH_APPROVED</code>, <code>SEO_INDEXING_ENABLED</code> and <code>SEO_REVIEWED_PRODUCT_SLUGS</code> through server settings after review. These controls do not certify regulatory compliance or guarantee search eligibility.</p><p>{report.productMarkup} Organic search, product rich results, Merchant listings and paid advertising have separate requirements.</p><p>Rules reviewed {report.reviewedOn}. <a href="https://developers.google.com/search/docs/essentials/spam-policies" target="_blank" rel="noopener noreferrer">Google Search policies</a> · <a href="https://support.google.com/merchants/answer/12079605?hl=en" target="_blank" rel="noopener noreferrer">Merchant healthcare policies</a></p></details>
  </section>;
}
