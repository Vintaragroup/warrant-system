import DashboardScreen from "../components/Bail_bond_dash_main";
import DashboardAggregatedProvider from "../components/DashboardAggregatedProvider.jsx";

export default function Dashboard() {
  return (
    <DashboardAggregatedProvider>
      <DashboardScreen />
    </DashboardAggregatedProvider>
  );
}