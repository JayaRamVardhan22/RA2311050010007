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

// Type weights: Placement > Result > Event
const TYPE_WEIGHT = {
  Placement: 3,
  Result: 2,
  Event: 1,
};

function getScore(notification) {
  const weight = TYPE_WEIGHT[notification.Type] || 0;
  const timestamp = new Date(notification.Timestamp).getTime();
  return weight * 1e12 + timestamp;
}

// Max-Heap implementation
class MaxHeap {
  constructor() {
    this.heap = [];
  }

  insert(notification) {
    this.heap.push(notification);
    this._bubbleUp(this.heap.length - 1);
  }

  extractMax() {
    if (this.heap.length === 0) return null;
    const max = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._sinkDown(0);
    }
    return max;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (getScore(this.heap[parent]) >= getScore(this.heap[i])) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  _sinkDown(i) {
    const n = this.heap.length;
    while (true) {
      let largest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && getScore(this.heap[left]) > getScore(this.heap[largest])) largest = left;
      if (right < n && getScore(this.heap[right]) > getScore(this.heap[largest])) largest = right;
      if (largest === i) break;
      [this.heap[largest], this.heap[i]] = [this.heap[i], this.heap[largest]];
      i = largest;
    }
  }

  size() {
    return this.heap.length;
  }
}

function getTopN(notifications, n) {
  const heap = new MaxHeap();
  for (const notification of notifications) {
    heap.insert(notification);
  }
  const result = [];
  for (let i = 0; i < n && heap.size() > 0; i++) {
    result.push(heap.extractMax());
  }
  return result;
}

async function main() {
  await Log("backend", "info", "service", "Priority inbox service started");

  const token = await getToken();
  await Log("backend", "info", "auth", "Token obtained for notifications fetch");

  // Fetch notifications
  await Log("backend", "info", "service", "Fetching notifications from API");
  const res = await fetch(`${BASE_URL}/notifications`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  const notifications = data.notifications;
  await Log("backend", "info", "service", `Fetched ${notifications.length} notifications`);

  // Get top 10
  const top10 = getTopN(notifications, 10);
  await Log("backend", "info", "service", "Top 10 priority notifications computed using max-heap");

  console.log("\n===== TOP 10 PRIORITY NOTIFICATIONS =====\n");
  top10.forEach((n, i) => {
    console.log(`${i + 1}. [${n.Type}] ${n.Message}`);
    console.log(`   ID: ${n.ID}`);
    console.log(`   Timestamp: ${n.Timestamp}`);
    console.log(`   Priority Score: ${getScore(n)}`);
    console.log();
  });

  await Log("backend", "info", "service", "Priority inbox results displayed successfully");
}

main();