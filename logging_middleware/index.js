const TOKEN_URL = "http://20.207.122.201/evaluation-service/auth";
const LOG_URL = "http://20.207.122.201/evaluation-service/logs";

const credentials = {
  email: "jn5611@srmist.edu.in",
  name: "Jayaram Vardhan Nandigam",
  rollNo: "RA2311050010007",
  accessCode: "QkbpxH",
  clientID: "2a81d2fe-e334-4c86-ba4a-7c9f7e457ccf",
  clientSecret: "WJKHuPYwHzUvCYjb",
};

let cachedToken = null;
let tokenExpiry = null;

async function getToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000 - 60000);
  return cachedToken;
}

async function Log(stack, level, package_name, message) {
  try {
    const token = await getToken();
    const response = await fetch(LOG_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        stack: stack,
        level: level,
        package: package_name,
        message: message,
      }),
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Logging failed:", error.message);
  }
}

module.exports = { Log };