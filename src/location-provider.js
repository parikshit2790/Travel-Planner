export const LOCATION_MIN_QUERY_LENGTH = 2;
export const LOCATION_SEARCH_DEBOUNCE_MS = 300;

export class LocationSearchProvider {
  async search() {
    throw new Error("LocationSearchProvider.search must be implemented");
  }
}

export class NominatimLocationSearchProvider extends LocationSearchProvider {
  constructor({ endpoint = "https://nominatim.openstreetmap.org/search" } = {}) {
    super();
    this.endpoint = endpoint;
    this.provider = "OpenStreetMap Nominatim";
  }

  async search(query) {
    const url = new URL(this.endpoint);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "8");
    url.searchParams.set("dedupe", "1");
    const response = await fetch(url.toString(), { headers: { Accept: "application/json", "Accept-Language": "en-US,en;q=0.8" } });
    if (!response.ok) throw new Error("Location provider unavailable");
    const results = await response.json();
    return rankLocations(dedupeLocations(results.map((result) => normalizeNominatimResult(result, this.provider))), query).slice(0, 8);
  }
}

export function createLocationSearchProvider() {
  if (typeof fetch !== "function") return null;
  return new NominatimLocationSearchProvider();
}

export function dedupeLocations(results) {
  const seen = new Set();
  return results.filter((result) => {
    const key = `${result.normalizedName}|${result.locationType}|${result.providerPlaceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function rankLocations(results, query) {
  const normalizedQuery = normalizeComparable(query);
  return [...results].sort((a, b) => locationScore(b, normalizedQuery) - locationScore(a, normalizedQuery));
}

function locationScore(location, normalizedQuery) {
  const name = normalizeComparable(location.normalizedName || location.displayName);
  const display = normalizeComparable(location.displayName);
  const city = normalizeComparable(location.city);
  const state = normalizeComparable(location.stateOrProvince);
  const countryCode = String(location.countryCode || "").toUpperCase();
  const type = String(location.locationType || "");
  let score = 0;
  if (name === normalizedQuery || city === normalizedQuery) score += 1000;
  if (name.startsWith(normalizedQuery) || city.startsWith(normalizedQuery)) score += 760;
  if (city) score += 220;
  if (type === "Airport") score += 180;
  if (["State", "Province", "Region"].includes(type)) score += 80;
  if (display.includes(normalizedQuery)) score += 55;
  if (countryCode === "US") score += 34;
  if (state) score += 10;
  return score;
}

function normalizeComparable(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeNominatimResult(result, provider) {
  const address = result.address || {};
  const locationType = inferLocationType(result, address);
  const airportCode = airportCodeFrom(result);
  const city = address.city || address.town || address.village || address.hamlet || "";
  const stateOrProvince = address.state || address.province || address.region || "";
  const country = address.country || "";
  const shortName = compactName([city || result.name, stateOrProvince, country]);
  return {
    originalInput: "",
    normalizedName: shortName || result.display_name || result.name || "",
    displayName: result.display_name || shortName || result.name || "",
    locationType,
    city,
    region: address.region || "",
    stateOrProvince,
    country,
    countryCode: String(address.country_code || "").toUpperCase(),
    provider,
    providerPlaceId: String(result.place_id || result.osm_id || ""),
    latitude: result.lat ? Number(result.lat) : null,
    longitude: result.lon ? Number(result.lon) : null,
    airportCode,
    verificationStatus: "Verified",
    verifiedAt: new Date().toISOString()
  };
}

function inferLocationType(result, address) {
  const haystack = `${result.class || ""} ${result.type || ""} ${result.addresstype || ""} ${result.display_name || ""}`.toLowerCase();
  if (haystack.includes("airport") || /\b[A-Z]{3}\b/.test(String(result.display_name || ""))) return "Airport";
  if (address.city || address.town || address.village || address.hamlet) return "City";
  if (address.state || result.addresstype === "state") return "State";
  if (address.country && result.addresstype === "country") return "Country";
  if (haystack.includes("region") || haystack.includes("county") || haystack.includes("peninsula")) return "Region";
  return titleCase(result.addresstype || result.type || "Place");
}

function airportCodeFrom(result) {
  const match = String(result.display_name || "").match(/\b([A-Z]{3})\b/);
  return inferLocationType(result, result.address || {}) === "Airport" ? match?.[1] || "" : "";
}

function compactName(parts) {
  return parts.filter(Boolean).filter((part, index, arr) => arr.indexOf(part) === index).join(", ");
}

function titleCase(value) {
  return String(value || "").replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
