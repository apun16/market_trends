import TrendsDashboard from "@/components/TrendsDashboard";
import { buildDashboardData } from "@/lib/dashboard";
import { getBuyers, getIndustry, getMeta, getSignals } from "@/lib/data";

export default function Dashboard() {
  return <TrendsDashboard mode="dashboard" data={buildDashboardData(getMeta(), getIndustry(), getSignals(), getBuyers())} />;
}
