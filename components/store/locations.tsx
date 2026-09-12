import { ArrowUpRight } from 'lucide-react';

export function Locations() {
  return <div className="locations-page locations-original">
    <div className="locations-overview"><div className="locations-heading"><h1>Locations</h1><p>Las Vegas is where our peptide retail story began. Find BIOMOD in Nevada and Utah, with Dallas and Los Angeles planned next.</p></div>
    <img className="locations-original-photo" src="/brand/original-locations-v11.jpeg" alt="BIOMOD branded window display from the original Locations page" width={1024} height={559} fetchPriority="high"/></div>
    <div className="locations-grid">
      <section><div className="location-heading-row"><p className="location-region">Nevada</p><span className="location-status">Current location</span></div><h2>Las Vegas</h2><address>6625 S Valley View Blvd<br/>Suite D420<br/>Las Vegas, NV 89118</address><a className="editorial-link" href="/contact?subject=Las%20Vegas%20location">Contact the Las Vegas team <ArrowUpRight size={18}/></a></section>
      <section><div className="location-heading-row"><p className="location-region">Utah</p><span className="location-status">Current location</span></div><h2>St. George</h2><address>422 W Lamond Circle<br/>Washington, UT 84780</address><a className="editorial-link" href="/contact?subject=Utah%20location">Contact the Utah team <ArrowUpRight size={18}/></a></section>
      <section className="location-planned"><div className="location-heading-row"><p className="location-region">Texas</p><span className="location-status">Planned for 2026</span></div><h2>Dallas</h2><p>Coming soon.</p></section>
      <section className="location-planned"><div className="location-heading-row"><p className="location-region">California</p><span className="location-status">Planned for 2026</span></div><h2>Los Angeles</h2><p>Coming soon.</p></section>
    </div>
    <div className="locations-contact"><p>Contact our team for visiting hours and location questions.</p><a href="mailto:contact@biomodpeptides.com">contact@biomodpeptides.com</a></div>
  </div>;
}
