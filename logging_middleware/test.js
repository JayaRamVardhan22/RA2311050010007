const { Log } = require("./index");

async function test() {
  console.log("Testing logging middleware...");
  
  const result = await Log("backend", "info", "utils", "Logging middleware test successful");
  console.log("Response:", result);
}

test();