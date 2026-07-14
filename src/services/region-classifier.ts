export type Region =
  | 'India'
  | 'LATAM'
  | 'USA'
  | 'Europe'
  | 'Africa'
  | 'Middle East'
  | 'Asia-Pacific'
  | 'Unknown/Global'

// Country-level mappings (highest confidence)
const COUNTRY_TO_REGION: Record<string, Region> = {
  india: 'India', bharat: 'India',
  'united states': 'USA', 'united states of america': 'USA', usa: 'USA', 'u.s.': 'USA', 'u.s.a.': 'USA', america: 'USA',
  argentina: 'LATAM', brazil: 'LATAM', brasil: 'LATAM', mexico: 'LATAM', chile: 'LATAM', colombia: 'LATAM',
  peru: 'LATAM', uruguay: 'LATAM', paraguay: 'LATAM', bolivia: 'LATAM', ecuador: 'LATAM', venezuela: 'LATAM',
  cuba: 'LATAM', 'dominican republic': 'LATAM', 'costa rica': 'LATAM', panama: 'LATAM', guatemala: 'LATAM',
  honduras: 'LATAM', 'el salvador': 'LATAM', nicaragua: 'LATAM', 'puerto rico': 'LATAM',
  'united kingdom': 'Europe', uk: 'Europe', england: 'Europe', scotland: 'Europe', wales: 'Europe',
  germany: 'Europe', france: 'Europe', spain: 'Europe', portugal: 'Europe', italy: 'Europe',
  netherlands: 'Europe', belgium: 'Europe', switzerland: 'Europe', austria: 'Europe', ireland: 'Europe',
  sweden: 'Europe', norway: 'Europe', denmark: 'Europe', finland: 'Europe', poland: 'Europe',
  czechia: 'Europe', romania: 'Europe', hungary: 'Europe', greece: 'Europe', croatia: 'Europe',
  slovenia: 'Europe', slovakia: 'Europe', bulgaria: 'Europe', serbia: 'Europe', ukraine: 'Europe',
  lithuania: 'Europe', latvia: 'Europe', estonia: 'Europe', luxembourg: 'Europe', malta: 'Europe',
  cyprus: 'Europe', iceland: 'Europe', monaco: 'Europe', andorra: 'Europe',
  nigeria: 'Africa', 'south africa': 'Africa', kenya: 'Africa', egypt: 'Africa', ghana: 'Africa',
  ethiopia: 'Africa', tanzania: 'Africa', uganda: 'Africa', morocco: 'Africa', algeria: 'Africa',
  tunisia: 'Africa', senegal: 'Africa', cameroon: 'Africa', madagascar: 'Africa', mauritius: 'Africa',
  'saudi arabia': 'Middle East', uae: 'Middle East', 'united arab emirates': 'Middle East',
  qatar: 'Middle East', bahrain: 'Middle East', kuwait: 'Middle East', oman: 'Middle East',
  jordan: 'Middle East', lebanon: 'Middle East', israel: 'Middle East', turkey: 'Middle East',
  iraq: 'Middle East', iran: 'Middle East', yemen: 'Middle East', syria: 'Middle East',
  china: 'Asia-Pacific', japan: 'Asia-Pacific', 'south korea': 'Asia-Pacific', korea: 'Asia-Pacific',
  singapore: 'Asia-Pacific', malaysia: 'Asia-Pacific', thailand: 'Asia-Pacific', vietnam: 'Asia-Pacific',
  philippines: 'Asia-Pacific', indonesia: 'Asia-Pacific', taiwan: 'Asia-Pacific', 'hong kong': 'Asia-Pacific',
  'new zealand': 'Asia-Pacific', australia: 'Asia-Pacific', pakistan: 'Asia-Pacific', bangladesh: 'Asia-Pacific',
  'sri lanka': 'Asia-Pacific', nepal: 'Asia-Pacific', myanmar: 'Asia-Pacific', cambodia: 'Asia-Pacific',
}

// State/province-level mappings
const STATE_TO_REGION: Record<string, Region> = {
  gujarat: 'India', maharashtra: 'India', karnataka: 'India', 'tamil nadu': 'India', telangana: 'India',
  delhi: 'India', 'new delhi': 'India', rajasthan: 'India', 'uttar pradesh': 'India', kerala: 'India',
  andhra: 'India', odisha: 'India', punjab: 'India', haryana: 'India', bihar: 'India',
  goa: 'India', himachal: 'India', assam: 'India', jammu: 'India', kashmir: 'India',
  california: 'USA', 'new york': 'USA', texas: 'USA', florida: 'USA', illinois: 'USA',
  pennsylvania: 'USA', ohio: 'USA', georgia: 'USA', 'north carolina': 'USA', michigan: 'USA',
  'new jersey': 'USA', virginia: 'USA', washington: 'USA', arizona: 'USA', massachusetts: 'USA',
  tennessee: 'USA', indiana: 'USA', missouri: 'USA', maryland: 'USA', wisconsin: 'USA',
  colorado: 'USA', minnesota: 'USA', 'south carolina': 'USA', alabama: 'USA', louisiana: 'USA',
  kentucky: 'USA', oregon: 'USA', oklahoma: 'USA', connecticut: 'USA', utah: 'USA',
  iowa: 'USA', nevada: 'USA', arkansas: 'USA', mississippi: 'USA', kansas: 'USA',
  'new mexico': 'USA', nebraska: 'USA', idaho: 'USA', 'west virginia': 'USA', hawaii: 'USA',
  'new hampshire': 'USA', maine: 'USA', montana: 'USA', rhode: 'USA', delaware: 'USA',
  'south dakota': 'USA', 'north dakota': 'USA', alaska: 'USA', vermont: 'USA', wyoming: 'USA',
  dc: 'USA',
  england: 'Europe', scotland: 'Europe', wales: 'Europe', bavaria: 'Europe', catalonia: 'Europe',
}

// City-level mappings
const CITY_TO_REGION: Record<string, Region> = {
  mumbai: 'India', bangalore: 'India', bengaluru: 'India', hyderabad: 'India', chennai: 'India',
  delhi: 'India', 'new delhi': 'India', pune: 'India', ahmedabad: 'India', ahmadabad: 'India',
  kolkata: 'India', jaipur: 'India', lucknow: 'India', nagpur: 'India', indore: 'India',
  surat: 'India', rajkot: 'India', chandigarh: 'India', coimbatore: 'India', kochi: 'India',
  mysore: 'India', noida: 'India', gurugram: 'India', gurgaon: 'India', amritsar: 'India',
  ludhiana: 'India', agra: 'India', varanasi: 'India', thane: 'India', bhopal: 'India',
  'san francisco': 'USA', seattle: 'USA', boston: 'USA', 'los angeles': 'USA', chicago: 'USA',
  austin: 'USA', denver: 'USA', atlanta: 'USA', miami: 'USA', dallas: 'USA', houston: 'USA',
  'san diego': 'USA', 'san jose': 'USA', portland: 'USA', phoenix: 'USA', detroit: 'USA',
  minneapolis: 'USA', philadelphia: 'USA', nashville: 'USA', raleigh: 'USA', charlotte: 'USA',
  pittsburgh: 'USA', baltimore: 'USA', pottstown: 'USA', 'las vegas': 'USA', sacramento: 'USA',
  orlando: 'USA', tampa: 'USA', 'salt lake city': 'USA',
  'buenos aires': 'LATAM', 'sao paulo': 'LATAM', 'são paulo': 'LATAM', 'rio de janeiro': 'LATAM',
  bogota: 'LATAM', bogotá: 'LATAM', santiago: 'LATAM', lima: 'LATAM', medellin: 'LATAM',
  medellín: 'LATAM', quito: 'LATAM', montevideo: 'LATAM', 'mexico city': 'LATAM', cdmx: 'LATAM',
  guadalajara: 'LATAM', monterrey: 'LATAM', brasilia: 'LATAM', curitiba: 'LATAM',
  'belo horizonte': 'LATAM', campinas: 'LATAM', 'porto alegre': 'LATAM', recife: 'LATAM',
  london: 'Europe', paris: 'Europe', berlin: 'Europe', munich: 'Europe', amsterdam: 'Europe',
  dublin: 'Europe', barcelona: 'Europe', madrid: 'Europe', rome: 'Europe', milan: 'Europe',
  zurich: 'Europe', geneva: 'Europe', vienna: 'Europe', prague: 'Europe', warsaw: 'Europe',
  budapest: 'Europe', lisbon: 'Europe', copenhagen: 'Europe', stockholm: 'Europe', oslo: 'Europe',
  helsinki: 'Europe', brussels: 'Europe', edinburgh: 'Europe', manchester: 'Europe',
  lagos: 'Africa', nairobi: 'Africa', cairo: 'Africa', 'cape town': 'Africa', johannesburg: 'Africa',
  accra: 'Africa', casablanca: 'Africa',
  dubai: 'Middle East', 'abu dhabi': 'Middle East', doha: 'Middle East', riyadh: 'Middle East',
  istanbul: 'Middle East', 'tel aviv': 'Middle East',
  tokyo: 'Asia-Pacific', seoul: 'Asia-Pacific', singapore: 'Asia-Pacific', 'hong kong': 'Asia-Pacific',
  sydney: 'Asia-Pacific', melbourne: 'Asia-Pacific', bangkok: 'Asia-Pacific', 'kuala lumpur': 'Asia-Pacific',
  jakarta: 'Asia-Pacific', manila: 'Asia-Pacific', beijing: 'Asia-Pacific', shanghai: 'Asia-Pacific',
  taipei: 'Asia-Pacific', lahore: 'Asia-Pacific', islamabad: 'Asia-Pacific', karachi: 'Asia-Pacific',
}

// Special keywords
const SPECIAL_KEYWORDS: Record<string, Region> = {
  remote: 'Unknown/Global', worldwide: 'Unknown/Global', global: 'Unknown/Global',
  distributed: 'Unknown/Global', anywhere: 'Unknown/Global', wfh: 'Unknown/Global', hybrid: 'Unknown/Global',
}

function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[.,;:!?'"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function classifyRegion(rawLocation: string): Region {
  if (!rawLocation) return 'Unknown/Global'
  const n = normalize(rawLocation)

  // 1. Special keywords
  for (const [keyword, region] of Object.entries(SPECIAL_KEYWORDS)) {
    if (n.includes(keyword)) return region
  }

  // 2. Country match
  for (const [country, region] of Object.entries(COUNTRY_TO_REGION)) {
    if (n.includes(country)) return region
  }

  // 3. State match
  for (const [state, region] of Object.entries(STATE_TO_REGION)) {
    if (n.includes(state)) return region
  }

  // 4. City match
  for (const [city, region] of Object.entries(CITY_TO_REGION)) {
    if (n.includes(city)) return region
  }

  // 5. Handle concatenated input (e.g., "AhmedabadGujaratIndia")
  for (const [country, region] of Object.entries(COUNTRY_TO_REGION)) {
    const noSpace = country.replace(/\s+/g, '')
    if (n.includes(noSpace)) return region
  }
  for (const [state, region] of Object.entries(STATE_TO_REGION)) {
    const noSpace = state.replace(/\s+/g, '')
    if (n.includes(noSpace)) return region
  }
  for (const [city, region] of Object.entries(CITY_TO_REGION)) {
    const noSpace = city.replace(/\s+/g, '')
    if (n.includes(noSpace)) return region
  }

  return 'Unknown/Global'
}
