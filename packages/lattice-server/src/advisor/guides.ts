/** Bounded, versioned implementation notes reviewed against primary specifications. */
export function standardGuide(url:string){
 if(url.replace(/\/$/,'')!=='https://wiki.open311.org/GeoReport_v2')return null;
 return {version:'Open311 GeoReport v2',steward:'Open311 community',reviewedOn:'2026-10-13',evidenceUrl:'https://wiki.open311.org/GeoReport_v2/',scope:'Location-based, non-emergency service requests; not collection schedules or arbitrary municipal records.',requirements:[
  'Provide service discovery and the service/service-request methods required for the chosen implementation role.',
  'XML support is required by GeoReport v2; JSON alone is not full conformance.',
  'Request creation uses form-encoded input; the native JSON read API proposed here does not implement request creation.',
  'Preserve timezone information on request timestamps.',
  'Request status is open or closed. Preserve finer workflow states separately rather than silently discarding them.',
  'Use jurisdiction_id when serving multiple jurisdictions; establish identifier scope explicitly.'
 ],conformance:'Not assessed: these notes are a review checklist, not a complete conformance suite.'};
}
