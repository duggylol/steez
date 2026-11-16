import { useEffect, useRef } from 'react';
import { mountSubathonPage } from './subathonPage.js';

/** Hosts the Subathon dashboard (vanilla DOM) inside the React shell. */
export default function SubathonPage() {
  const ref = useRef(null);
  useEffect(() => mountSubathonPage(ref.current), []);
  return <div ref={ref} />;
}
