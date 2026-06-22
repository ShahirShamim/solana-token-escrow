export type SolanaYieldVibe = {
  "address": "CrCv1oVV3Ft2S2G1WjtjAyyXwG41YGMvFbYxeLmQ8yx6",
  "metadata": {
    "name": "solana_yield_vibe",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "initialize_pool",
      "discriminator": [
        95,
        180,
        10,
        172,
        84,
        174,
        232,
        40
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "staking_mint",
          "writable": false,
          "signer": false
        },
        {
          "name": "reward_mint",
          "writable": false,
          "signer": false
        },
        {
          "name": "pool_state",
          "writable": true,
          "signer": false
        },
        {
          "name": "staking_vault",
          "writable": true,
          "signer": false
        },
        {
          "name": "system_program",
          "writable": false,
          "signer": false
        },
        {
          "name": "token_program",
          "writable": false,
          "signer": false
        },
        {
          "name": "associated_token_program",
          "writable": false,
          "signer": false
        }
      ],
      "args": [
        {
          "name": "reward_rate",
          "type": "u64"
        }
      ]
    },
    {
      "name": "stake",
      "discriminator": [
        206,
        176,
        202,
        18,
        200,
        209,
        179,
        108
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "pool_state",
          "writable": true,
          "signer": false
        },
        {
          "name": "user_state",
          "writable": true,
          "signer": false
        },
        {
          "name": "staking_vault",
          "writable": true,
          "signer": false
        },
        {
          "name": "user_staking_account",
          "writable": true,
          "signer": false
        },
        {
          "name": "system_program",
          "writable": false,
          "signer": false
        },
        {
          "name": "token_program",
          "writable": false,
          "signer": false
        },
        {
          "name": "associated_token_program",
          "writable": false,
          "signer": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "claim",
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "pool_state",
          "writable": false,
          "signer": false
        },
        {
          "name": "user_state",
          "writable": true,
          "signer": false
        },
        {
          "name": "reward_mint",
          "writable": true,
          "signer": false
        },
        {
          "name": "user_reward_account",
          "writable": true,
          "signer": false
        },
        {
          "name": "token_program",
          "writable": false,
          "signer": false
        }
      ],
      "args": []
    },
    {
      "name": "unstake",
      "discriminator": [
        90,
        95,
        107,
        42,
        205,
        124,
        50,
        225
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "pool_state",
          "writable": false,
          "signer": false
        },
        {
          "name": "user_state",
          "writable": true,
          "signer": false
        },
        {
          "name": "staking_vault",
          "writable": true,
          "signer": false
        },
        {
          "name": "user_staking_account",
          "writable": true,
          "signer": false
        },
        {
          "name": "token_program",
          "writable": false,
          "signer": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "PoolState",
      "discriminator": [
        247,
        237,
        227,
        245,
        215,
        195,
        222,
        70
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "staking_mint",
            "type": "pubkey"
          },
          {
            "name": "reward_mint",
            "type": "pubkey"
          },
          {
            "name": "staking_vault",
            "type": "pubkey"
          },
          {
            "name": "reward_rate",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "UserState",
      "discriminator": [
        72,
        177,
        85,
        249,
        76,
        167,
        186,
        126
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "staked_balance",
            "type": "u64"
          },
          {
            "name": "last_stake_timestamp",
            "type": "i64"
          },
          {
            "name": "accrued_rewards",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "ZeroAmount",
      "msg": "Amount must be greater than zero."
    },
    {
      "code": 6001,
      "name": "MathOverflow",
      "msg": "Math overflow error occurred."
    },
    {
      "code": 6002,
      "name": "NoRewardsToClaim",
      "msg": "No rewards available to claim."
    },
    {
      "code": 6003,
      "name": "InsufficientStakeBalance",
      "msg": "Insufficient staked balance."
    }
  ]
};