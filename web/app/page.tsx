import TrendsDashboard from "@/components/TrendsDashboard";
import { buildDashboardData } from "@/lib/dashboard";
import { getBuyers, getIndustry, getMeta, getSignals } from "@/lib/data";

export default function Home() {
  return <TrendsDashboard mode="home" data={buildDashboardData(getMeta(), getIndustry(), getSignals(), getBuyers())} />;
}
