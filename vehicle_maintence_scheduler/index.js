const { Log } = require("../logging_middleware/index");

const BASE_URL = "http://20.207.122.201/evaluation-service";
const TOKEN_URL = "http://20.207.122.201/evaluation-service/auth";

const credentials = {
  email: "jn5611@srmist.edu.in",
  name: "Jayaram Vardhan Nandigam",
  rollNo: "RA2311050010007",
  accessCode: "QkbpxH",
  clientID: "2a81d2fe-e334-4c86-ba4a-7c9f7e457ccf",
  clientSecret: "WJKHuPYwHzUvCYjb",
};

async function getToken() {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  const data = await response.json();
  return data.access_token;
}

function scheduleVehicles(vehicles, mechanicHours) {
  // Dynamic programming knapsack solution
  const n = vehicles.length;
  const capacity = mechanicHours;
  
  // Create DP table
  const dp = Array(n + 1).fill(null).map(() => Array(capacity + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    const duration = vehicles[i - 1].Duration;
    const impact = vehicles[i - 1].Impact;
    for (let w = 0; w <= capacity; w++) {
      if (duration <= w) {
        dp[i][w] = Math.max(dp[i - 1][w], dp[i - 1][w - duration] + impact);
      } else {
        dp[i][w] = dp[i - 1][w];
      }
    }
  }

  // Trace back selected tasks
  const selected = [];
  let w = capacity;
  for (let i = n; i > 0; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      selected.push(vehicles[i - 1]);
      w -= vehicles[i - 1].Duration;
    }
  }

  return {
    selectedTasks: selected,
    totalImpact: dp[n][capacity],
    totalDuration: selected.reduce((sum, v) => sum + v.Duration, 0),
  };
}

async function main() {
  await Log("backend", "info", "service", "Vehicle maintenance scheduler started");

  const token = await getToken();
  await Log("backend", "info", "auth", "Authorization token obtained");

  // Fetch depots
  await Log("backend", "info", "service", "Fetching depots from API");
  const depotsRes = await fetch(`${BASE_URL}/depots`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const depotsData = await depotsRes.json();
  const depots = depotsData.depots;
  await Log("backend", "info", "service", `Fetched ${depots.length} depots`);

  // Fetch vehicles
  await Log("backend", "info", "service", "Fetching vehicles from API");
  const vehiclesRes = await fetch(`${BASE_URL}/vehicles`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const vehiclesData = await vehiclesRes.json();
  const vehicles = vehiclesData.vehicles;
  await Log("backend", "info", "service", `Fetched ${vehicles.length} vehicles`);

  // Schedule for each depot
  const results = [];
  for (const depot of depots) {
    await Log("backend", "info", "service", `Scheduling tasks for depot ${depot.ID} with ${depot.MechanicHours} mechanic hours`);
    
    const result = scheduleVehicles(vehicles, depot.MechanicHours);
    
    await Log("backend", "info", "service", `Depot ${depot.ID}: selected ${result.selectedTasks.length} tasks, total impact ${result.totalImpact}, total duration ${result.totalDuration}`);

    results.push({
      depotID: depot.ID,
      mechanicHours: depot.MechanicHours,
      totalImpact: result.totalImpact,
      totalDuration: result.totalDuration,
      selectedTasks: result.selectedTasks.map((t) => t.TaskID),
    });
  }

  await Log("backend", "info", "service", "Vehicle maintenance scheduling completed for all depots");

  console.log("\n===== VEHICLE MAINTENANCE SCHEDULER RESULTS =====\n");
  for (const r of results) {
    console.log(`Depot ${r.depotID} (Budget: ${r.mechanicHours} hours)`);
    console.log(`  Total Impact Score : ${r.totalImpact}`);
    console.log(`  Total Duration Used: ${r.totalDuration} hours`);
    console.log(`  Tasks Selected     : ${r.selectedTasks.length}`);
    console.log(`  Task IDs:`);
    r.selectedTasks.forEach((id) => console.log(`    - ${id}`));
    console.log();
  }
}

main();