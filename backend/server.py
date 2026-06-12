import http.server
import json
import time
from urllib.parse import urlparse, parse_qs

# Simulated global state
users_state = {}
pool_state = {
    "admin": "",
    "staking_mint": "StakingMint1111111111111111111111111111111",
    "reward_mint": "RewardMint11111111111111111111111111111111",
    "staking_vault": 0,  # TVL
    "reward_rate": 100000, # Default: 0.1 rewards per staked token per second (scaled by 1e6)
    "initialized": False
}

def get_user(wallet):
    if wallet not in users_state:
        users_state[wallet] = {
            "sol_balance": 1000.0,
            "staking_balance": 1000000000000,  # 1,000,000 tokens (6 decimals)
            "reward_balance": 0,
            "staked_balance": 0,
            "last_stake_timestamp": 0,
            "accrued_rewards": 0
        }
    return users_state[wallet]

class SimulatorHandler(http.server.BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed_path = urlparse(self.path)
        if parsed_path.path == "/api/state":
            query_components = parse_qs(parsed_path.query)
            wallet = query_components.get("wallet", [""])[0]
            
            if not wallet:
                self.send_error_response(400, "Wallet address required")
                return

            user = get_user(wallet)
            
            # Calculate real-time yield to display in dashboard
            pending_yield = calculate_pending_yield(
                user["staked_balance"], 
                pool_state["reward_rate"], 
                user["last_stake_timestamp"]
            )
            unclaimed_rewards = user["accrued_rewards"] + pending_yield

            response_data = {
                "pool": pool_state,
                "user": {
                    "wallet": wallet,
                    "sol_balance": user["sol_balance"],
                    "staking_balance": user["staking_balance"],
                    "reward_balance": user["reward_balance"],
                    "staked_balance": user["staked_balance"],
                    "last_stake_timestamp": user["last_stake_timestamp"],
                    "accrued_rewards": user["accrued_rewards"],
                    "unclaimed_rewards": unclaimed_rewards
                }
            }
            self.send_json_response(200, response_data)
        else:
            self.send_error_response(404, "Not Found")

    def do_POST(self):
        parsed_path = urlparse(self.path)
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')
        
        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self.send_error_response(400, "Invalid JSON")
            return

        if parsed_path.path == "/api/setup":
            wallet = data.get("wallet")
            if not wallet:
                self.send_error_response(400, "Wallet required")
                return
            # Reset user
            users_state[wallet] = {
                "sol_balance": 1000.0,
                "staking_balance": 1000000000000,
                "reward_balance": 0,
                "staked_balance": 0,
                "last_stake_timestamp": 0,
                "accrued_rewards": 0
            }
            self.send_json_response(200, {"status": "success", "message": "Local environment set up successfully", "wallet": wallet})

        elif parsed_path.path == "/api/initialize":
            admin = data.get("admin")
            reward_rate = int(data.get("reward_rate", 100000))
            pool_state["admin"] = admin
            pool_state["reward_rate"] = reward_rate
            pool_state["initialized"] = True
            self.send_json_response(200, {"status": "success", "message": "Pool initialized successfully"})

        elif parsed_path.path == "/api/stake":
            wallet = data.get("wallet")
            amount = int(data.get("amount", 0))
            if not wallet or amount <= 0:
                self.send_error_response(400, "Invalid request params")
                return

            user = get_user(wallet)
            if user["staking_balance"] < amount:
                self.send_error_response(400, "Insufficient staking tokens")
                return

            # Accrue yield first
            now = int(time.time())
            pending = calculate_pending_yield(user["staked_balance"], pool_state["reward_rate"], user["last_stake_timestamp"])
            user["accrued_rewards"] += pending
            
            # Execute stake
            user["staking_balance"] -= amount
            user["staked_balance"] += amount
            user["last_stake_timestamp"] = now
            pool_state["staking_vault"] += amount

            self.send_json_response(200, {"status": "success", "message": f"Successfully staked {amount} tokens"})

        elif parsed_path.path == "/api/claim":
            wallet = data.get("wallet")
            if not wallet:
                self.send_error_response(400, "Wallet required")
                return

            user = get_user(wallet)
            now = int(time.time())
            
            # Accrue yield
            pending = calculate_pending_yield(user["staked_balance"], pool_state["reward_rate"], user["last_stake_timestamp"])
            total_rewards = user["accrued_rewards"] + pending
            
            if total_rewards <= 0:
                self.send_error_response(400, "No rewards to claim")
                return

            user["reward_balance"] += total_rewards
            user["accrued_rewards"] = 0
            user["last_stake_timestamp"] = now

            self.send_json_response(200, {"status": "success", "message": f"Claimed {total_rewards} rewards"})

        elif parsed_path.path == "/api/unstake":
            wallet = data.get("wallet")
            amount = int(data.get("amount", 0))
            if not wallet or amount <= 0:
                self.send_error_response(400, "Invalid request params")
                return

            user = get_user(wallet)
            if user["staked_balance"] < amount:
                self.send_error_response(400, "Insufficient staked balance")
                return

            # Accrue yield
            now = int(time.time())
            pending = calculate_pending_yield(user["staked_balance"], pool_state["reward_rate"], user["last_stake_timestamp"])
            user["accrued_rewards"] += pending

            # Execute unstake
            user["staked_balance"] -= amount
            user["staking_balance"] += amount
            user["last_stake_timestamp"] = now
            pool_state["staking_vault"] -= amount

            self.send_json_response(200, {"status": "success", "message": f"Successfully unstaked {amount} tokens"})

        else:
            self.send_error_response(404, "Not Found")

    def send_json_response(self, status, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def send_error_response(self, status, message):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"error": message}).encode('utf-8'))

def calculate_pending_yield(balance, reward_rate, last_stake_timestamp):
    if balance == 0 or last_stake_timestamp == 0:
        return 0
    now = int(time.time())
    time_delta = now - last_stake_timestamp
    if time_delta <= 0:
        return 0
    return (balance * reward_rate * time_delta) // 1000000

if __name__ == "__main__":
    server_address = ('', 8899)
    httpd = http.server.HTTPServer(server_address, SimulatorHandler)
    print("Simulated Solana Yield Vibe backend running on port 8899...")
    httpd.serve_forever()
