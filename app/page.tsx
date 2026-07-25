import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "RouteMosaic",
  description:
    "Personalized trip planning that uses explicit traveler preferences instead of generic itineraries.",
};

export default function Home() {
  return (
    <main style={{ minHeight: "100vh", padding: 32, fontFamily: "system-ui" }}>
      <p style={{ color: "#66788a", textTransform: "uppercase" }}>
        Personalized trip builder
      </p>
      <h1 style={{ color: "#102a43", fontSize: 48, margin: "0 0 12px" }}>
        RouteMosaic
      </h1>
      <p style={{ color: "#334e68", maxWidth: 720 }}>
        Build trips around the people going: preferences, restrictions, pace,
        food needs, comfort, budget, and confirmed plans.
      </p>
    </main>
  );
}
