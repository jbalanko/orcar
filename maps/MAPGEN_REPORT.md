# Map generation report

- Status: **OK**
- DXF: `model/Orcar_Oct-Linework.dxf` (sha256 e57af9bd60b4)
- Ghost box (all): [0.977, -0.646, 0.0] .. [158.672, 297.653, 135.772]
- Placeholder point: [79.824, 140.0, 45.0]

## Warnings
- `S4B`: bridged a 0.176" gap in the drawn path
- `S6C` is on DXF layer D but wired to board E in the template
- `R4`: 138 pixels over 227.5" = 1.66" pitch (expected ~1.37") -- check its count
- `DORSAL`: 72 pixels over 116.8" = 1.65" pitch (expected ~1.37") -- check its count

## Info
- ghost box X 0.977 .. 158.672  set by `RIGHT_PECTORAL` .. `LEFT_PECTORAL`
- ghost box Y -0.646 .. 297.653  set by `(box_extra)` .. `FLUKE`
- ghost box Z 0.000 .. 135.772  set by `R10` .. `FLUKE`

## Strands

| Board | Ch | Feature | Pixels | Drawn length (in) | Pitch (in) | Kind | Pixel 0 at | |
|---|---|---|---|---|---|---|---|---|
| A | 0 | R2 | 0 | 89.6 | - | not counted | - |  |
| A | 0 | R1 | 0 | 101.8 | - | not counted | - |  |
| A | 1 | R3 | 97 | 112.8 | 1.18 | line | (43.2, 55.0, 56.8) |  |
| A | 2 | R4 | 138 | 227.5 | 1.66 | line | (52.5, 79.4, 0.6) | check count |
| A | 3 | S2A | 0 | 55.3 | - | not counted | - |  |
| A | 3 | S4A | 0 | 51.0 | - | not counted | - |  |
| A | 3 | S6A | 0 | 50.2 | - | not counted | - |  |
| A | 4 | S8A | 0 | 51.0 | - | not counted | - |  |
| A | 4 | S10A | 0 | 55.3 | - | not counted | - |  |
| B | 0 | R5 | 166 | 231.7 | 1.40 | line | (49.0, 105.3, 0.0) |  |
| B | 1 | R6 | 0 | 230.0 | - | not counted | - |  |
| B | 2 | R7 | 171 | 230.0 | 1.35 | line | (41.8, 153.3, 0.0) |  |
| B | 3 | R8 | 170 | 226.2 | 1.34 | line | (47.1, 177.3, 0.0) |  |
| B | 4 | TEST | 300 | - | - | placeholder | - |  |
| C | 0 | S1B | 108 | 149.4 | 1.40 | line | (42.6, 79.4, 21.5) |  |
| C | 1 | S3B | 128 | 171.4 | 1.35 | line | (49.8, 55.0, 74.3) |  |
| C | 3 | S7B | 0 | 136.9 | - | not counted | - |  |
| C | 4 | S5B | 107 | 136.9 | 1.29 | line | (67.3, 79.4, 87.8) |  |
| C | 6 | S9B | 125 | 171.4 | 1.38 | line | (109.9, 55.0, 74.3) |  |
| C | 7 | S11B | 110 | 149.4 | 1.37 | line | (117.0, 79.4, 21.5) |  |
| D | 2 | DORSAL | 72 | 116.8 | 1.65 | line | (79.8, 142.8, 89.5) | check count |
| D | 3 | S6B | 0 | 88.2 | - | not counted | - |  |
| D | 4 | S10B | 173 | 233.4 | 1.36 | line | (116.1, 55.0, 56.7) |  |
| D | 5 | S8B | 0 | 240.5 | - | not counted | - |  |
| D | 6 | S4B | 172 | 240.5 | 1.41 | line | (58.7, 55.0, 85.0) |  |
| D | 7 | S2B | 172 | 233.4 | 1.37 | line | (43.6, 55.0, 56.7) |  |
| E | 0 | R9 | 163 | 207.9 | 1.28 | line | (49.7, 201.3, 0.0) |  |
| E | 1 | R10 | 150 | 202.8 | 1.36 | line | (44.4, 225.3, 0.0) |  |
| E | 2 | FLUKE | 0 | 216.7 | - | not counted | - |  |
| E | 3 | R11 | 0 | 102.6 | - | not counted | - |  |
| E | 3 | R12 | 0 | 101.8 | - | not counted | - |  |
| E | 4 | R13 | 0 | 64.1 | - | not counted | - |  |
| E | 4 | R14 | 0 | 32.7 | - | not counted | - |  |
| E | 5 | S6C | 64 | 90.7 | 1.44 | line | (79.8, 189.3, 84.6) |  |
| F | 4 | LEFT_PECTORAL | 103 | 135.4 | 1.33 | line | (117.0, 79.4, 21.5) |  |
| F | 5 | RIGHT_PECTORAL | 103 | 135.4 | 1.33 | line | (42.6, 79.4, 21.5) |  |
| F | 6 | EYE_1 | 112 | - | - | placeholder | - |  |
| F | 7 | EYE_2 | 112 | - | - | placeholder | - |  |
