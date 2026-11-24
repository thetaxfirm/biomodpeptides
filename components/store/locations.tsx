import { ArrowUpRight } from 'lucide-react';
import { storeDirectionsUrl, storeLocality, storeLocations } from '@/lib/store-locations';

export function Locations() {
  return <div className="locations-page locations-original">
    <div className="locations-overview"><div className="locations-heading"><h1>Locations</h1><p>Las Vegas is where our research compound retail story began. Visit a BIOMOD store in Nevada, Utah and now El Paso, Texas, with Dallas and Los Angeles planned next.</p></div>
    <img className="locations-original-photo" src="/brand/original-locations-v11.jpeg" alt="BIOMOD branded window display from the original Locations page" width={1024} height={559} fetchPriority="high"/></div>
    <div className="locations-grid">
      {storeLocations.map(store => <section key={store.id} id={store.id} className={store.status === 'New location' ? 'location-new' : undefined}>
        <div className="location-heading-row">
          <p className="location-region">{store.state}</p>
          <span className="location-status">{store.status}</span>
        </div>
        <h2>{store.label}</h2>
        <address>{store.street}<br/>{store.suite && <>{store.suite}<br/></>}{storeLocality(store)}</address>
        <div style={{ marginTop: 'auto' }}>
          <div><a className="editorial-link" href={storeDirectionsUrl(store)}>Directions to {store.label} <ArrowUpRight size={18} aria-hidden="true"/></a></div>
          <a className="editorial-link" href={'/contact?subject=' + encodeURIComponent(store.contactRegion + ' location')}>Contact the {store.contactRegion} team <ArrowUpRight size={18} aria-hidden="true"/></a>
        </div>
      </section>)}
      <section className="location-planned"><div className="location-heading-row"><p className="location-region">Texas</p><span className="location-status">Planned for 2026</span></div><h2>Dallas</h2><p>Coming soon.</p></section>
      <section className="location-planned"><div className="location-heading-row"><p className="location-region">California</p><span className="location-status">Planned for 2026</span></div><h2>Los Angeles</h2><p>Coming soon.</p></section>
    </div>
    <div className="locations-contact"><p>Contact our team for visiting hours and location questions.</p><a href="mailto:contact@trybiomod.com">contact@trybiomod.com</a></div>
  </div>;
}
