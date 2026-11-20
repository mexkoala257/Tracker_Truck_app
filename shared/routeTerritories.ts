// Auto-seeded from "Route Town Sequence.pdf" — editable anytime in /admin
export interface RouteStopPoint {
  name: string;
  state: string;
  lat: number;
  lon: number;
  /** Highlighted anchor / overnight / turnaround town in Route Town Sequence */
  anchor?: boolean;
  /** Hot Shot stop extensions (for live GPS green checkoff & account labels) */
  completed?: boolean;
  completedAt?: string | null;
  accountName?: string;
  address?: string;
  piecesCount?: number;
  notes?: string;
  stopOrder?: number;
}

export interface RouteTerritoryDefinition {
  id: string;
  name: string;
  truckGroup: string;
  defaultDriver: string;
  color: string;
  /** Schedule cell codes in Weekly Truck Schedule that activate this route (e.g. ["SLEEPY EYE-BOM/PIPE/SLAY"]) */
  scheduleCodes: string[];
  stops: RouteStopPoint[];
}

export type RouteOverlayFilterMode =
  | "off"
  | "today"
  | "hotshots_today"
  | "all"
  | "truck_1"
  | "truck_2"
  | "truck_3"
  | "truck_4"
  | "truck_5"
  | "custom";

export type RouteOverlayStyleMode =
  | "zones_and_sequence"
  | "zones_only"
  | "sequence_only";

export type RouteColorMode = "route" | "driver";

export interface ResolvedRouteOverlay {
  id: string;
  name: string;
  truckGroup: string;
  assignedDriver?: string;
  scheduleCellText?: string;
  color: string;
  stops: RouteStopPoint[];
  /** Smooth rounded convex-hull territory polygon [lat, lon][] */
  polygon: Array<[number, number]>;
  centroid: [number, number];
  /** True when rendered for a one-time Hot Shot dispatch */
  isHotShot?: boolean;
  /** Optional origination/return hub coordinates for Hot Shot polylines */
  originLocation?: { name: string; lat: number; lon: number };
}

export const ROUTE_FILTER_OPTIONS: Array<{ id: RouteOverlayFilterMode; label: string }> = [
  { id: "today", label: "Today's Scheduled Routes + Hot Shots (Auto-Sync)" },
  { id: "hotshots_today", label: "Today's Hot Shot Dispatches Only" },
  { id: "all", label: "All 23 Company Routes (Full Territory Map)" },
  { id: "truck_1", label: "Truck #1 Routes (Sonny)" },
  { id: "truck_2", label: "Truck #2 Routes (Prouty / Brandon)" },
  { id: "truck_3", label: "Truck #3 Routes (Nathan)" },
  { id: "truck_4", label: "Truck #4 Routes (Troy)" },
  { id: "truck_5", label: "Truck #5 Routes (Ron)" },
  { id: "custom", label: "Pick Specific Routes…" },
  { id: "off", label: "Hidden (Truck Pins Only)" },
];

export const DEFAULT_ROUTE_TERRITORIES: RouteTerritoryDefinition[] = [
  {
    "id": "route-benson",
    "name": "Benson (MN, SD)",
    "truckGroup": "Truck #1 — Sonny",
    "defaultDriver": "T01-Sonny",
    "color": "#38bdf8",
    "scheduleCodes": [
      "BENSON"
    ],
    "stops": [
      {
        "name": "Dawson",
        "state": "MN",
        "lat": 44.9327,
        "lon": -96.0545
      },
      {
        "name": "Montevideo",
        "state": "MN",
        "lat": 44.948,
        "lon": -95.717
      },
      {
        "name": "Clara City",
        "state": "MN",
        "lat": 44.955,
        "lon": -95.3664
      },
      {
        "name": "Raymond",
        "state": "MN",
        "lat": 45.0158,
        "lon": -95.2386
      },
      {
        "name": "Kerkhoven",
        "state": "MN",
        "lat": 45.193,
        "lon": -95.3206
      },
      {
        "name": "Benson",
        "state": "MN",
        "lat": 45.315,
        "lon": -95.6025,
        "anchor": true
      },
      {
        "name": "Appleton",
        "state": "MN",
        "lat": 45.1969,
        "lon": -96.0198
      },
      {
        "name": "Milan",
        "state": "MN",
        "lat": 45.1086,
        "lon": -95.9134
      },
      {
        "name": "Madison",
        "state": "MN",
        "lat": 45.0097,
        "lon": -96.1959
      },
      {
        "name": "Bellingham",
        "state": "MN",
        "lat": 45.1344,
        "lon": -96.2842
      },
      {
        "name": "Nassau",
        "state": "MN",
        "lat": 45.0663,
        "lon": -96.4398
      },
      {
        "name": "Revillo",
        "state": "SD",
        "lat": 45.0166,
        "lon": -96.5712
      },
      {
        "name": "Clear Lake",
        "state": "SD",
        "lat": 44.7458,
        "lon": -96.6826
      },
      {
        "name": "Brandt",
        "state": "SD",
        "lat": 44.6636,
        "lon": -96.6242
      },
      {
        "name": "Toronto",
        "state": "SD",
        "lat": 44.573,
        "lon": -96.6425
      },
      {
        "name": "Estelline",
        "state": "SD",
        "lat": 44.5747,
        "lon": -96.9023
      }
    ]
  },
  {
    "id": "route-redfield",
    "name": "Redfield (SD)",
    "truckGroup": "Truck #1 — Sonny",
    "defaultDriver": "T01-Sonny",
    "color": "#06b6d4",
    "scheduleCodes": [
      "REDFIELD"
    ],
    "stops": [
      {
        "name": "Doland",
        "state": "SD",
        "lat": 44.8958,
        "lon": -98.1007
      },
      {
        "name": "Conde",
        "state": "SD",
        "lat": 45.1572,
        "lon": -98.0976
      },
      {
        "name": "Ferney",
        "state": "SD",
        "lat": 45.3247,
        "lon": -98.0965
      },
      {
        "name": "Groton",
        "state": "SD",
        "lat": 45.4475,
        "lon": -98.0987
      },
      {
        "name": "Redfield",
        "state": "SD",
        "lat": 44.8758,
        "lon": -98.5187,
        "anchor": true
      },
      {
        "name": "Carpenter",
        "state": "SD",
        "lat": 44.6375,
        "lon": -97.9168
      },
      {
        "name": "Bryant",
        "state": "SD",
        "lat": 44.5905,
        "lon": -97.4673
      },
      {
        "name": "Hayti",
        "state": "SD",
        "lat": 44.6572,
        "lon": -97.2051
      },
      {
        "name": "Arlington",
        "state": "SD",
        "lat": 44.3644,
        "lon": -97.1331
      },
      {
        "name": "Badger",
        "state": "SD",
        "lat": 44.4852,
        "lon": -97.2048
      }
    ]
  },
  {
    "id": "route-redwood",
    "name": "Redwood (MN, SD)",
    "truckGroup": "Truck #1 — Sonny",
    "defaultDriver": "T01-Sonny",
    "color": "#0ea5e9",
    "scheduleCodes": [
      "REDWOOD"
    ],
    "stops": [
      {
        "name": "Boyd",
        "state": "MN",
        "lat": 44.8486,
        "lon": -95.9031
      },
      {
        "name": "Granite Falls",
        "state": "MN",
        "lat": 44.81,
        "lon": -95.5456
      },
      {
        "name": "Sacred Heart",
        "state": "MN",
        "lat": 44.7869,
        "lon": -95.3517
      },
      {
        "name": "Renville",
        "state": "MN",
        "lat": 44.7891,
        "lon": -95.2117
      },
      {
        "name": "Danube",
        "state": "MN",
        "lat": 44.7919,
        "lon": -95.0972
      },
      {
        "name": "Olivia",
        "state": "MN",
        "lat": 44.7764,
        "lon": -94.9897
      },
      {
        "name": "Bird Island",
        "state": "MN",
        "lat": 44.7675,
        "lon": -94.8956
      },
      {
        "name": "Hector",
        "state": "MN",
        "lat": 44.7439,
        "lon": -94.7155
      },
      {
        "name": "Buffalo Lake",
        "state": "MN",
        "lat": 44.7372,
        "lon": -94.6169
      },
      {
        "name": "Fairfax",
        "state": "MN",
        "lat": 44.5291,
        "lon": -94.7208
      },
      {
        "name": "Redwood Falls",
        "state": "MN",
        "lat": 44.5394,
        "lon": -95.1169,
        "anchor": true
      },
      {
        "name": "Echo",
        "state": "MN",
        "lat": 44.6169,
        "lon": -95.4175
      },
      {
        "name": "Wood Lake",
        "state": "MN",
        "lat": 44.6527,
        "lon": -95.5383
      },
      {
        "name": "Cottonwood",
        "state": "MN",
        "lat": 44.6088,
        "lon": -95.6742
      },
      {
        "name": "Hanley Falls",
        "state": "MN",
        "lat": 44.6927,
        "lon": -95.622
      },
      {
        "name": "Clarkfield",
        "state": "MN",
        "lat": 44.7889,
        "lon": -95.8039
      },
      {
        "name": "Ivanhoe",
        "state": "MN",
        "lat": 44.4633,
        "lon": -96.2473
      },
      {
        "name": "Hendricks",
        "state": "MN",
        "lat": 44.5072,
        "lon": -96.4242
      },
      {
        "name": "Bruce",
        "state": "SD",
        "lat": 44.438,
        "lon": -96.8901
      }
    ]
  },
  {
    "id": "route-webster",
    "name": "Webster (SD)",
    "truckGroup": "Truck #1 — Sonny",
    "defaultDriver": "T01-Sonny",
    "color": "#2dd4bf",
    "scheduleCodes": [
      "WEBSTER"
    ],
    "stops": [
      {
        "name": "Milbank",
        "state": "SD",
        "lat": 45.2191,
        "lon": -96.6356
      },
      {
        "name": "Wilmot",
        "state": "SD",
        "lat": 45.4086,
        "lon": -96.8578
      },
      {
        "name": "Summit",
        "state": "SD",
        "lat": 45.3044,
        "lon": -97.0365
      },
      {
        "name": "Waubay",
        "state": "SD",
        "lat": 45.3319,
        "lon": -97.3051
      },
      {
        "name": "Webster",
        "state": "SD",
        "lat": 45.3322,
        "lon": -97.5201,
        "anchor": true
      },
      {
        "name": "Eden",
        "state": "SD",
        "lat": 45.6166,
        "lon": -97.4198
      },
      {
        "name": "Henry",
        "state": "SD",
        "lat": 44.8772,
        "lon": -97.4665
      },
      {
        "name": "Vienna",
        "state": "SD",
        "lat": 44.703,
        "lon": -97.5015
      },
      {
        "name": "Clark",
        "state": "SD",
        "lat": 44.8777,
        "lon": -97.7331
      }
    ]
  },
  {
    "id": "route-yankton",
    "name": "Yankton (SD)",
    "truckGroup": "Truck #1 — Sonny",
    "defaultDriver": "T01-Sonny",
    "color": "#34d399",
    "scheduleCodes": [
      "YANKTON",
      "YANK/WAG",
      "YAN/WAG/CHAMB"
    ],
    "stops": [
      {
        "name": "Viborg",
        "state": "SD",
        "lat": 43.1703,
        "lon": -97.0814
      },
      {
        "name": "Centerville",
        "state": "SD",
        "lat": 43.1194,
        "lon": -96.9614
      },
      {
        "name": "Beresford",
        "state": "SD",
        "lat": 43.0805,
        "lon": -96.7737
      },
      {
        "name": "Vermillion",
        "state": "SD",
        "lat": 42.7794,
        "lon": -96.9292
      },
      {
        "name": "Meckling",
        "state": "SD",
        "lat": 42.8425,
        "lon": -97.0695
      },
      {
        "name": "Yankton",
        "state": "SD",
        "lat": 42.8711,
        "lon": -97.3973,
        "anchor": true
      },
      {
        "name": "Springfield",
        "state": "SD",
        "lat": 42.8542,
        "lon": -97.8973
      },
      {
        "name": "Tyndall",
        "state": "SD",
        "lat": 42.9933,
        "lon": -97.8628
      },
      {
        "name": "Scotland",
        "state": "SD",
        "lat": 43.1497,
        "lon": -97.7176
      },
      {
        "name": "Menno",
        "state": "SD",
        "lat": 43.2397,
        "lon": -97.5778
      },
      {
        "name": "Freeman",
        "state": "SD",
        "lat": 43.3525,
        "lon": -97.4373
      },
      {
        "name": "Salem",
        "state": "SD",
        "lat": 43.7242,
        "lon": -97.3889
      }
    ]
  },
  {
    "id": "route-fairmont",
    "name": "Fairmont (MN, IA)",
    "truckGroup": "Truck #2 — Prouty / Brandon",
    "defaultDriver": "T02-Brandon",
    "color": "#f97316",
    "scheduleCodes": [
      "FAIRMONT",
      "FAIR/SPIRIT",
      "FAIR/BOMG-PIPE/SLAY/FAIR/SPIRIT"
    ],
    "stops": [
      {
        "name": "Mountain Lake",
        "state": "MN",
        "lat": 43.9389,
        "lon": -94.9297
      },
      {
        "name": "St. James",
        "state": "MN",
        "lat": 43.9864,
        "lon": -94.5581
      },
      {
        "name": "Hanska",
        "state": "MN",
        "lat": 44.1489,
        "lon": -94.4941
      },
      {
        "name": "Madelia",
        "state": "MN",
        "lat": 44.0508,
        "lon": -94.4183
      },
      {
        "name": "Truman",
        "state": "MN",
        "lat": 43.8277,
        "lon": -94.4372
      },
      {
        "name": "Granada",
        "state": "MN",
        "lat": 43.6955,
        "lon": -94.3478
      },
      {
        "name": "Fairmont",
        "state": "MN",
        "lat": 43.6522,
        "lon": -94.4611
      },
      {
        "name": "Ormsby",
        "state": "MN",
        "lat": 43.8483,
        "lon": -94.6978
      },
      {
        "name": "Trimont",
        "state": "MN",
        "lat": 43.7622,
        "lon": -94.7072
      },
      {
        "name": "Sherburn",
        "state": "MN",
        "lat": 43.6522,
        "lon": -94.7269
      },
      {
        "name": "Dunnell",
        "state": "MN",
        "lat": 43.5594,
        "lon": -94.7744
      },
      {
        "name": "Alpha",
        "state": "MN",
        "lat": 43.6388,
        "lon": -94.8708
      },
      {
        "name": "Jackson",
        "state": "MN",
        "lat": 43.6208,
        "lon": -94.9886,
        "anchor": true
      },
      {
        "name": "Lakefield",
        "state": "MN",
        "lat": 43.6775,
        "lon": -95.1717
      },
      {
        "name": "Spirit Lake",
        "state": "IA",
        "lat": 43.4222,
        "lon": -95.1022
      },
      {
        "name": "Okoboji",
        "state": "IA",
        "lat": 43.3864,
        "lon": -95.1483
      },
      {
        "name": "Arnolds Park",
        "state": "IA",
        "lat": 43.3727,
        "lon": -95.1239
      },
      {
        "name": "Milford",
        "state": "IA",
        "lat": 43.3247,
        "lon": -95.15
      },
      {
        "name": "Montgomery",
        "state": "IA",
        "lat": 43.4425,
        "lon": -95.2189
      },
      {
        "name": "Lake Park",
        "state": "IA",
        "lat": 43.4555,
        "lon": -95.3208
      },
      {
        "name": "Round Lake",
        "state": "MN",
        "lat": 43.5405,
        "lon": -95.4683
      }
    ]
  },
  {
    "id": "route-huron",
    "name": "Huron (SD)",
    "truckGroup": "Truck #2 — Prouty / Brandon",
    "defaultDriver": "T02-Brandon",
    "color": "#fb923c",
    "scheduleCodes": [
      "HURON"
    ],
    "stops": [
      {
        "name": "Huron",
        "state": "SD",
        "lat": 44.3633,
        "lon": -98.2143,
        "anchor": true
      },
      {
        "name": "Yale",
        "state": "SD",
        "lat": 44.4339,
        "lon": -97.9901
      },
      {
        "name": "De Smet",
        "state": "SD",
        "lat": 44.3875,
        "lon": -97.5503
      }
    ]
  },
  {
    "id": "route-mitchell",
    "name": "Mitchell (SD)",
    "truckGroup": "Truck #2 — Prouty / Brandon",
    "defaultDriver": "T02-Brandon",
    "color": "#ef4444",
    "scheduleCodes": [
      "MITCHELL"
    ],
    "stops": [
      {
        "name": "Ethan",
        "state": "SD",
        "lat": 43.5478,
        "lon": -97.9881
      },
      {
        "name": "Parkston",
        "state": "SD",
        "lat": 43.3989,
        "lon": -97.9837
      },
      {
        "name": "Tripp",
        "state": "SD",
        "lat": 43.2255,
        "lon": -97.9659
      },
      {
        "name": "Wagner",
        "state": "SD",
        "lat": 43.0797,
        "lon": -98.2931
      },
      {
        "name": "Armour",
        "state": "SD",
        "lat": 43.3186,
        "lon": -98.3468
      },
      {
        "name": "Corsica",
        "state": "SD",
        "lat": 43.4253,
        "lon": -98.4073
      },
      {
        "name": "New Holland",
        "state": "SD",
        "lat": 43.4283,
        "lon": -98.6131
      },
      {
        "name": "Stickney",
        "state": "SD",
        "lat": 43.5892,
        "lon": -98.4373
      },
      {
        "name": "Plankinton",
        "state": "SD",
        "lat": 43.7156,
        "lon": -98.4851
      },
      {
        "name": "Mount Vernon",
        "state": "SD",
        "lat": 43.7105,
        "lon": -98.2604
      },
      {
        "name": "Mitchell",
        "state": "SD",
        "lat": 43.7094,
        "lon": -98.0298,
        "anchor": true
      },
      {
        "name": "Alexandria",
        "state": "SD",
        "lat": 43.6536,
        "lon": -97.7828
      },
      {
        "name": "Emery",
        "state": "SD",
        "lat": 43.6016,
        "lon": -97.6226
      },
      {
        "name": "Bridgewater",
        "state": "SD",
        "lat": 43.5517,
        "lon": -97.5076
      }
    ]
  },
  {
    "id": "route-sleepy-eye",
    "name": "Sleepy Eye (MN, SD)",
    "truckGroup": "Truck #2 — Prouty / Brandon",
    "defaultDriver": "T02-Brandon",
    "color": "#f43f5e",
    "scheduleCodes": [
      "SLEEPY EYE",
      "SLEEPY EYE-BOM/PIPE/SLAY"
    ],
    "stops": [
      {
        "name": "Slayton",
        "state": "MN",
        "lat": 43.9877,
        "lon": -95.7558
      },
      {
        "name": "Currie",
        "state": "MN",
        "lat": 44.0714,
        "lon": -95.6664
      },
      {
        "name": "Westbrook",
        "state": "MN",
        "lat": 44.0422,
        "lon": -95.4361
      },
      {
        "name": "Jeffers",
        "state": "MN",
        "lat": 44.0558,
        "lon": -95.1967
      },
      {
        "name": "Sanborn",
        "state": "MN",
        "lat": 44.2097,
        "lon": -95.1286
      },
      {
        "name": "Lamberton",
        "state": "MN",
        "lat": 44.2311,
        "lon": -95.2642
      },
      {
        "name": "Wanda",
        "state": "MN",
        "lat": 44.3163,
        "lon": -95.2117
      },
      {
        "name": "Springfield",
        "state": "MN",
        "lat": 44.2388,
        "lon": -94.9758
      },
      {
        "name": "Sleepy Eye",
        "state": "MN",
        "lat": 44.2972,
        "lon": -94.7241
      },
      {
        "name": "Morgan",
        "state": "MN",
        "lat": 44.4169,
        "lon": -94.9256
      },
      {
        "name": "Wabasso",
        "state": "MN",
        "lat": 44.4019,
        "lon": -95.2558
      },
      {
        "name": "Milroy",
        "state": "MN",
        "lat": 44.4177,
        "lon": -95.5533
      },
      {
        "name": "Marshall",
        "state": "MN",
        "lat": 44.4469,
        "lon": -95.7883,
        "anchor": true
      },
      {
        "name": "Tracy",
        "state": "MN",
        "lat": 44.2333,
        "lon": -95.6192
      },
      {
        "name": "Amiret",
        "state": "MN",
        "lat": 44.3161,
        "lon": -95.6761
      },
      {
        "name": "Balaton",
        "state": "MN",
        "lat": 44.2333,
        "lon": -95.8722
      },
      {
        "name": "Ruthton",
        "state": "MN",
        "lat": 44.1766,
        "lon": -96.1039
      },
      {
        "name": "Tyler",
        "state": "MN",
        "lat": 44.2783,
        "lon": -96.1347
      },
      {
        "name": "Lake Benton",
        "state": "MN",
        "lat": 44.2611,
        "lon": -96.2875
      },
      {
        "name": "Elkton",
        "state": "SD",
        "lat": 44.2361,
        "lon": -96.4811
      }
    ]
  },
  {
    "id": "route-chamberlain",
    "name": "Chamberlain (SD)",
    "truckGroup": "Truck #3 — Nathan",
    "defaultDriver": "TO3-Nate",
    "color": "#eab308",
    "scheduleCodes": [
      "CHAMBERLAIN",
      "CHAMBERLAIN-BOM/CHAMB"
    ],
    "stops": [
      {
        "name": "Platte",
        "state": "SD",
        "lat": 43.3869,
        "lon": -98.8445
      },
      {
        "name": "Geddes",
        "state": "SD",
        "lat": 43.2536,
        "lon": -98.6954
      },
      {
        "name": "Pickstown",
        "state": "SD",
        "lat": 43.0672,
        "lon": -98.532
      },
      {
        "name": "Fairfax",
        "state": "SD",
        "lat": 43.0275,
        "lon": -98.8884
      },
      {
        "name": "Burke",
        "state": "SD",
        "lat": 43.1825,
        "lon": -99.2921
      },
      {
        "name": "Gregory",
        "state": "SD",
        "lat": 43.2322,
        "lon": -99.4304
      },
      {
        "name": "Chamberlain",
        "state": "SD",
        "lat": 43.8108,
        "lon": -99.3307,
        "anchor": true
      },
      {
        "name": "Pukwana",
        "state": "SD",
        "lat": 43.7781,
        "lon": -99.1815
      },
      {
        "name": "Kimball",
        "state": "SD",
        "lat": 43.7467,
        "lon": -98.9584
      },
      {
        "name": "White Lake",
        "state": "SD",
        "lat": 43.7303,
        "lon": -98.7137
      },
      {
        "name": "Letcher",
        "state": "SD",
        "lat": 43.8972,
        "lon": -98.1387
      },
      {
        "name": "Storla",
        "state": "SD",
        "lat": 43.8414,
        "lon": -98.3742
      },
      {
        "name": "Artesian",
        "state": "SD",
        "lat": 44.0091,
        "lon": -97.9209
      },
      {
        "name": "Madison",
        "state": "SD",
        "lat": 44.0061,
        "lon": -97.114
      }
    ]
  },
  {
    "id": "route-iowa",
    "name": "Iowa (IA, SD)",
    "truckGroup": "Truck #3 — Nathan",
    "defaultDriver": "TO3-Nate",
    "color": "#84cc16",
    "scheduleCodes": [
      "IOWA"
    ],
    "stops": [
      {
        "name": "Rock Rapids",
        "state": "IA",
        "lat": 43.4272,
        "lon": -96.1759
      },
      {
        "name": "Little Rock",
        "state": "IA",
        "lat": 43.4441,
        "lon": -95.8833
      },
      {
        "name": "Bigelow",
        "state": "MN",
        "lat": 43.5052,
        "lon": -95.69
      },
      {
        "name": "Melvin",
        "state": "IA",
        "lat": 43.2875,
        "lon": -95.6092
      },
      {
        "name": "Ocheyedan",
        "state": "IA",
        "lat": 43.4161,
        "lon": -95.5347
      },
      {
        "name": "Sibley",
        "state": "IA",
        "lat": 43.3991,
        "lon": -95.752
      },
      {
        "name": "George",
        "state": "IA",
        "lat": 43.3439,
        "lon": -96.0022
      },
      {
        "name": "Hudson",
        "state": "SD",
        "lat": 43.1303,
        "lon": -96.4542
      },
      {
        "name": "Hawarden",
        "state": "IA",
        "lat": 42.9958,
        "lon": -96.4853
      },
      {
        "name": "Westfield",
        "state": "IA",
        "lat": 42.7555,
        "lon": -96.6059
      },
      {
        "name": "North Sioux City",
        "state": "SD",
        "lat": 42.5272,
        "lon": -96.4831,
        "anchor": true
      },
      {
        "name": "Elk Point",
        "state": "SD",
        "lat": 42.6833,
        "lon": -96.6837
      },
      {
        "name": "Akron",
        "state": "IA",
        "lat": 42.8289,
        "lon": -96.5595
      },
      {
        "name": "Alcester",
        "state": "SD",
        "lat": 43.0214,
        "lon": -96.6309
      },
      {
        "name": "Chester",
        "state": "SD",
        "lat": 43.895,
        "lon": -96.9265
      },
      {
        "name": "Madison",
        "state": "SD",
        "lat": 44.0061,
        "lon": -97.114
      }
    ]
  },
  {
    "id": "route-marshall",
    "name": "Marshall (MN)",
    "truckGroup": "Truck #3 — Nathan",
    "defaultDriver": "TO3-Nate",
    "color": "#facc15",
    "scheduleCodes": [
      "MARSHALL"
    ],
    "stops": [
      {
        "name": "Pipestone",
        "state": "MN",
        "lat": 44.0005,
        "lon": -96.3175
      },
      {
        "name": "Slayton",
        "state": "MN",
        "lat": 43.9877,
        "lon": -95.7558
      },
      {
        "name": "Tracy",
        "state": "MN",
        "lat": 44.2333,
        "lon": -95.6192
      },
      {
        "name": "Marshall",
        "state": "MN",
        "lat": 44.4469,
        "lon": -95.7883,
        "anchor": true
      },
      {
        "name": "Ghent",
        "state": "MN",
        "lat": 44.5127,
        "lon": -95.8911
      }
    ]
  },
  {
    "id": "route-midwest",
    "name": "Midwest (MN)",
    "truckGroup": "Truck #3 — Nathan",
    "defaultDriver": "TO3-Nate",
    "color": "#fde047",
    "scheduleCodes": [
      "MIDWEST"
    ],
    "stops": [
      {
        "name": "Pipestone",
        "state": "MN",
        "lat": 44.0005,
        "lon": -96.3175
      },
      {
        "name": "Slayton",
        "state": "MN",
        "lat": 43.9877,
        "lon": -95.7558
      },
      {
        "name": "Tracy",
        "state": "MN",
        "lat": 44.2333,
        "lon": -95.6192
      },
      {
        "name": "Marshall",
        "state": "MN",
        "lat": 44.4469,
        "lon": -95.7883,
        "anchor": true
      },
      {
        "name": "Minneota",
        "state": "MN",
        "lat": 44.5588,
        "lon": -95.9856
      },
      {
        "name": "Porter",
        "state": "MN",
        "lat": 44.6364,
        "lon": -96.1656
      },
      {
        "name": "Canby",
        "state": "MN",
        "lat": 44.7088,
        "lon": -96.2764
      }
    ]
  },
  {
    "id": "route-ortonville",
    "name": "Ortonville (MN, SD)",
    "truckGroup": "Truck #3 — Nathan",
    "defaultDriver": "TO3-Nate",
    "color": "#a3e635",
    "scheduleCodes": [
      "ORTON",
      "ORTONVILLE"
    ],
    "stops": [
      {
        "name": "Browns Valley",
        "state": "MN",
        "lat": 45.5952,
        "lon": -96.8334
      },
      {
        "name": "Beardsley",
        "state": "MN",
        "lat": 45.5583,
        "lon": -96.7123
      },
      {
        "name": "Graceville",
        "state": "MN",
        "lat": 45.5691,
        "lon": -96.4345
      },
      {
        "name": "Clinton",
        "state": "MN",
        "lat": 45.4622,
        "lon": -96.4387
      },
      {
        "name": "Ortonville",
        "state": "MN",
        "lat": 45.3047,
        "lon": -96.4448,
        "anchor": true
      },
      {
        "name": "Big Stone City",
        "state": "SD",
        "lat": 45.2916,
        "lon": -96.4628
      },
      {
        "name": "Milbank",
        "state": "SD",
        "lat": 45.2191,
        "lon": -96.6356
      },
      {
        "name": "Goodwin",
        "state": "SD",
        "lat": 44.8791,
        "lon": -96.8487
      }
    ]
  },
  {
    "id": "route-wessington",
    "name": "Wessington Springs (SD)",
    "truckGroup": "Truck #3 — Nathan",
    "defaultDriver": "TO3-Nate",
    "color": "#fbbf24",
    "scheduleCodes": [
      "SPRINGS",
      "WESSINGTON"
    ],
    "stops": [
      {
        "name": "Alpena",
        "state": "SD",
        "lat": 44.1814,
        "lon": -98.3657
      },
      {
        "name": "Wessington Springs",
        "state": "SD",
        "lat": 44.0792,
        "lon": -98.5695,
        "anchor": true
      },
      {
        "name": "Lane",
        "state": "SD",
        "lat": 44.0697,
        "lon": -98.4251
      },
      {
        "name": "Woonsocket",
        "state": "SD",
        "lat": 44.0536,
        "lon": -98.2756
      },
      {
        "name": "Epiphany",
        "state": "SD",
        "lat": 43.8566,
        "lon": -97.5015
      },
      {
        "name": "Canova",
        "state": "SD",
        "lat": 43.8811,
        "lon": -97.5045
      },
      {
        "name": "Howard",
        "state": "SD",
        "lat": 44.0108,
        "lon": -97.5267
      },
      {
        "name": "Carthage",
        "state": "SD",
        "lat": 44.1711,
        "lon": -97.7165
      },
      {
        "name": "Lake Preston",
        "state": "SD",
        "lat": 44.3636,
        "lon": -97.3773
      }
    ]
  },
  {
    "id": "route-aberdeen",
    "name": "Aberdeen (SD)",
    "truckGroup": "Truck #4 — Troy",
    "defaultDriver": "T04-Troy",
    "color": "#60a5fa",
    "scheduleCodes": [
      "ABERDEEN"
    ],
    "stops": [
      {
        "name": "Peever",
        "state": "SD",
        "lat": 45.543,
        "lon": -96.9548
      },
      {
        "name": "Sisseton",
        "state": "SD",
        "lat": 45.6647,
        "lon": -97.0498
      },
      {
        "name": "New Effington",
        "state": "SD",
        "lat": 45.8563,
        "lon": -96.9204
      },
      {
        "name": "Veblen",
        "state": "SD",
        "lat": 45.863,
        "lon": -97.2876
      },
      {
        "name": "Lake City",
        "state": "SD",
        "lat": 45.7252,
        "lon": -97.4145
      },
      {
        "name": "Britton",
        "state": "SD",
        "lat": 45.7916,
        "lon": -97.7509
      },
      {
        "name": "Hecla",
        "state": "SD",
        "lat": 45.883,
        "lon": -98.1521
      },
      {
        "name": "Frederick",
        "state": "SD",
        "lat": 45.8325,
        "lon": -98.5062
      },
      {
        "name": "Barnard",
        "state": "SD",
        "lat": 45.7366,
        "lon": -98.4812
      },
      {
        "name": "Westport",
        "state": "SD",
        "lat": 45.6489,
        "lon": -98.497
      },
      {
        "name": "Aberdeen",
        "state": "SD",
        "lat": 45.4647,
        "lon": -98.4865,
        "anchor": true
      },
      {
        "name": "Bath",
        "state": "SD",
        "lat": 45.4694,
        "lon": -98.3198
      },
      {
        "name": "Langford",
        "state": "SD",
        "lat": 45.6024,
        "lon": -97.8304
      },
      {
        "name": "Pierpont",
        "state": "SD",
        "lat": 45.4955,
        "lon": -97.8312
      },
      {
        "name": "Bristol",
        "state": "SD",
        "lat": 45.3447,
        "lon": -97.7484
      }
    ]
  },
  {
    "id": "route-brookings",
    "name": "Brookings (SD)",
    "truckGroup": "Truck #4 — Troy",
    "defaultDriver": "T04-Troy",
    "color": "#818cf8",
    "scheduleCodes": [
      "BROOKINGS"
    ],
    "stops": [
      {
        "name": "Volga",
        "state": "SD",
        "lat": 44.3236,
        "lon": -96.9265
      },
      {
        "name": "Brookings",
        "state": "SD",
        "lat": 44.3114,
        "lon": -96.7984,
        "anchor": true
      },
      {
        "name": "Arlington",
        "state": "SD",
        "lat": 44.3644,
        "lon": -97.1331
      }
    ]
  },
  {
    "id": "route-miller",
    "name": "Miller (SD)",
    "truckGroup": "Truck #4 — Troy",
    "defaultDriver": "T04-Troy",
    "color": "#3b82f6",
    "scheduleCodes": [
      "MILLER"
    ],
    "stops": [
      {
        "name": "St. Lawrence",
        "state": "SD",
        "lat": 44.5186,
        "lon": -98.9384
      },
      {
        "name": "Highmore",
        "state": "SD",
        "lat": 44.5214,
        "lon": -99.4415
      },
      {
        "name": "Blunt",
        "state": "SD",
        "lat": 44.5122,
        "lon": -99.9921
      },
      {
        "name": "Onida",
        "state": "SD",
        "lat": 44.708,
        "lon": -100.0598
      },
      {
        "name": "Agar",
        "state": "SD",
        "lat": 44.8383,
        "lon": -100.0746
      },
      {
        "name": "Gettysburg",
        "state": "SD",
        "lat": 45.0117,
        "lon": -99.9557
      },
      {
        "name": "Seneca",
        "state": "SD",
        "lat": 45.0616,
        "lon": -99.5121
      },
      {
        "name": "Hoven",
        "state": "SD",
        "lat": 45.2436,
        "lon": -99.7771
      },
      {
        "name": "Roscoe",
        "state": "SD",
        "lat": 45.4486,
        "lon": -99.3387
      },
      {
        "name": "Bowdle",
        "state": "SD",
        "lat": 45.453,
        "lon": -99.654
      },
      {
        "name": "Eureka",
        "state": "SD",
        "lat": 45.7694,
        "lon": -99.6196
      },
      {
        "name": "Leola",
        "state": "SD",
        "lat": 45.7227,
        "lon": -98.9409
      },
      {
        "name": "Ipswich",
        "state": "SD",
        "lat": 45.4444,
        "lon": -99.0293
      },
      {
        "name": "Aberdeen",
        "state": "SD",
        "lat": 45.4647,
        "lon": -98.4865,
        "anchor": true
      },
      {
        "name": "Warner",
        "state": "SD",
        "lat": 45.3258,
        "lon": -98.4954
      },
      {
        "name": "Mellette",
        "state": "SD",
        "lat": 45.1544,
        "lon": -98.4976
      },
      {
        "name": "Chelsea",
        "state": "SD",
        "lat": 45.1686,
        "lon": -98.7395
      },
      {
        "name": "Faulkton",
        "state": "SD",
        "lat": 45.035,
        "lon": -99.124
      },
      {
        "name": "Orient",
        "state": "SD",
        "lat": 44.9002,
        "lon": -99.0893
      },
      {
        "name": "Miller",
        "state": "SD",
        "lat": 44.5183,
        "lon": -98.9884
      },
      {
        "name": "Wessington",
        "state": "SD",
        "lat": 44.4541,
        "lon": -98.697
      },
      {
        "name": "Wolsey",
        "state": "SD",
        "lat": 44.4078,
        "lon": -98.4748
      },
      {
        "name": "Cavour",
        "state": "SD",
        "lat": 44.37,
        "lon": -98.0379
      },
      {
        "name": "Iroquois",
        "state": "SD",
        "lat": 44.3669,
        "lon": -97.8509
      }
    ]
  },
  {
    "id": "route-pipestone",
    "name": "Pipestone (MN)",
    "truckGroup": "Truck #4 — Troy",
    "defaultDriver": "T04-Troy",
    "color": "#a855f7",
    "scheduleCodes": [
      "PIPESTONE"
    ],
    "stops": [
      {
        "name": "Luverne",
        "state": "MN",
        "lat": 43.6541,
        "lon": -96.2128
      },
      {
        "name": "Hills",
        "state": "MN",
        "lat": 43.528,
        "lon": -96.3586
      },
      {
        "name": "Steen",
        "state": "MN",
        "lat": 43.5147,
        "lon": -96.2631
      },
      {
        "name": "Ellsworth",
        "state": "MN",
        "lat": 43.518,
        "lon": -96.0184
      },
      {
        "name": "Adrian",
        "state": "MN",
        "lat": 43.635,
        "lon": -95.9328
      },
      {
        "name": "Worthington",
        "state": "MN",
        "lat": 43.62,
        "lon": -95.5964
      },
      {
        "name": "Windom",
        "state": "MN",
        "lat": 43.8663,
        "lon": -95.1169
      },
      {
        "name": "Fulda",
        "state": "MN",
        "lat": 43.8705,
        "lon": -95.6003
      },
      {
        "name": "Iona",
        "state": "MN",
        "lat": 43.9155,
        "lon": -95.7842
      },
      {
        "name": "Chandler",
        "state": "MN",
        "lat": 43.9291,
        "lon": -95.9472
      },
      {
        "name": "Lake Wilson",
        "state": "MN",
        "lat": 43.9966,
        "lon": -95.9528
      },
      {
        "name": "Slayton",
        "state": "MN",
        "lat": 43.9877,
        "lon": -95.7558,
        "anchor": true
      },
      {
        "name": "Edgerton",
        "state": "MN",
        "lat": 43.8725,
        "lon": -96.1286
      },
      {
        "name": "Pipestone",
        "state": "MN",
        "lat": 44.0005,
        "lon": -96.3175
      },
      {
        "name": "Flandreau",
        "state": "SD",
        "lat": 44.0494,
        "lon": -96.5953
      }
    ]
  },
  {
    "id": "route-watertown",
    "name": "Watertown (SD)",
    "truckGroup": "Truck #4 — Troy",
    "defaultDriver": "T04-Troy",
    "color": "#6366f1",
    "scheduleCodes": [
      "WATERTOWN"
    ],
    "stops": [
      {
        "name": "Castlewood",
        "state": "SD",
        "lat": 44.7227,
        "lon": -97.0301
      },
      {
        "name": "Watertown",
        "state": "SD",
        "lat": 44.8994,
        "lon": -97.1151,
        "anchor": true
      }
    ]
  },
  {
    "id": "route-canton",
    "name": "Canton (IA, SD)",
    "truckGroup": "Truck #5 — Ron",
    "defaultDriver": "T05-Ron",
    "color": "#10b981",
    "scheduleCodes": [
      "CANTON",
      "CAN/HAW/LUV"
    ],
    "stops": [
      {
        "name": "Canton",
        "state": "SD",
        "lat": 43.3008,
        "lon": -96.5928,
        "anchor": true
      },
      {
        "name": "Doon",
        "state": "IA",
        "lat": 43.2794,
        "lon": -96.2328
      },
      {
        "name": "Inwood",
        "state": "IA",
        "lat": 43.3072,
        "lon": -96.432
      },
      {
        "name": "Larchwood",
        "state": "IA",
        "lat": 43.4536,
        "lon": -96.4342
      },
      {
        "name": "Brandon",
        "state": "SD",
        "lat": 43.5947,
        "lon": -96.572
      },
      {
        "name": "Garretson",
        "state": "SD",
        "lat": 43.7175,
        "lon": -96.5028
      },
      {
        "name": "Colman",
        "state": "SD",
        "lat": 43.9825,
        "lon": -96.8145
      },
      {
        "name": "Wentworth",
        "state": "SD",
        "lat": 43.9972,
        "lon": -96.9642
      }
    ]
  },
  {
    "id": "route-lennox",
    "name": "Lennox (SD)",
    "truckGroup": "Truck #5 — Ron",
    "defaultDriver": "T05-Ron",
    "color": "#ec4899",
    "scheduleCodes": [
      "LENNOX"
    ],
    "stops": [
      {
        "name": "Marion",
        "state": "SD",
        "lat": 43.423,
        "lon": -97.2606
      },
      {
        "name": "Parker",
        "state": "SD",
        "lat": 43.3975,
        "lon": -97.1364
      },
      {
        "name": "Chancellor",
        "state": "SD",
        "lat": 43.3722,
        "lon": -96.987
      },
      {
        "name": "Lennox",
        "state": "SD",
        "lat": 43.3541,
        "lon": -96.892,
        "anchor": true
      },
      {
        "name": "Tea",
        "state": "SD",
        "lat": 43.4464,
        "lon": -96.8359
      },
      {
        "name": "Sioux Falls",
        "state": "SD",
        "lat": 43.5437,
        "lon": -96.728
      },
      {
        "name": "Crooks",
        "state": "SD",
        "lat": 43.6647,
        "lon": -96.8109
      },
      {
        "name": "Colton",
        "state": "SD",
        "lat": 43.7861,
        "lon": -96.9276
      }
    ]
  },
  {
    "id": "route-sioux-falls",
    "name": "Sioux Falls (SD)",
    "truckGroup": "Truck #5 — Ron",
    "defaultDriver": "T05-Ron",
    "color": "#c084fc",
    "scheduleCodes": [
      "SF",
      "SIOUX FALLS"
    ],
    "stops": [
      {
        "name": "Sioux Falls",
        "state": "SD",
        "lat": 43.5437,
        "lon": -96.728,
        "anchor": true
      },
      {
        "name": "Harrisburg",
        "state": "SD",
        "lat": 43.4314,
        "lon": -96.6973
      },
      {
        "name": "Hartford",
        "state": "SD",
        "lat": 43.623,
        "lon": -96.9425
      },
      {
        "name": "Dell Rapids",
        "state": "SD",
        "lat": 43.8261,
        "lon": -96.7062
      }
    ]
  }
];

export function normalizeRouteTerritories(
  raw: unknown,
  fallback: RouteTerritoryDefinition[] = DEFAULT_ROUTE_TERRITORIES,
): RouteTerritoryDefinition[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return fallback.map((r) => ({
      ...r,
      scheduleCodes: [...r.scheduleCodes],
      stops: r.stops.map((s) => ({ ...s })),
    }));
  }
  const out: RouteTerritoryDefinition[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, any>;
    if (!r.id || !r.name || !Array.isArray(r.stops)) continue;
    const stops: RouteStopPoint[] = r.stops
      .filter(
        (s: any) =>
          s &&
          typeof s.name === "string" &&
          Number.isFinite(Number(s.lat)) &&
          Number.isFinite(Number(s.lon)),
      )
      .map((s: any) => ({
        name: String(s.name).trim(),
        state: String(s.state || "SD").trim().toUpperCase(),
        lat: Number(Number(s.lat).toFixed(4)),
        lon: Number(Number(s.lon).toFixed(4)),
        ...(s.anchor ? { anchor: true } : {}),
      }));
    if (stops.length === 0) continue;
    out.push({
      id: String(r.id),
      name: String(r.name).trim(),
      truckGroup: String(r.truckGroup || "Fleet Routes").trim(),
      defaultDriver: String(r.defaultDriver || "").trim(),
      color: typeof r.color === "string" && r.color.startsWith("#") ? r.color : "#38bdf8",
      scheduleCodes: Array.isArray(r.scheduleCodes)
        ? r.scheduleCodes.map((c: any) => String(c).trim().toUpperCase()).filter(Boolean)
        : [],
      stops,
    });
  }
  return out.length > 0 ? out : fallback;
}

/**
 * Computes a smooth, rounded territory polygon around a route's stops (radius ~6.5 miles)
 * using Monotone Chain convex hull over 10-point radial buffers around each town.
 */
export function computeRouteTerritoryPolygon(
  stops: RouteStopPoint[],
  bufferMiles = 6.5,
): { polygon: Array<[number, number]>; centroid: [number, number] } {
  if (stops.length === 0) {
    return { polygon: [], centroid: [43.5446, -96.7311] };
  }

  const lat0 = stops.reduce((s, p) => s + p.lat, 0) / stops.length;
  const lon0 = stops.reduce((s, p) => s + p.lon, 0) / stops.length;
  const cosLat = Math.max(0.25, Math.cos((lat0 * Math.PI) / 180));
  const milesPerLat = 69.0;
  const milesPerLon = 69.0 * cosLat;

  const samplePts: Array<{ x: number; y: number }> = [];
  const radialSteps = 10;
  for (const s of stops) {
    const cx = (s.lon - lon0) * milesPerLon;
    const cy = (s.lat - lat0) * milesPerLat;
    for (let k = 0; k < radialSteps; k++) {
      const ang = (2 * Math.PI * k) / radialSteps;
      samplePts.push({
        x: cx + bufferMiles * Math.cos(ang),
        y: cy + bufferMiles * Math.sin(ang),
      });
    }
  }

  samplePts.sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
  const cross = (
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Array<{ x: number; y: number }> = [];
  for (const p of samplePts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Array<{ x: number; y: number }> = [];
  for (let i = samplePts.length - 1; i >= 0; i--) {
    const p = samplePts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  const hull = lower.concat(upper);

  const polygon: Array<[number, number]> = hull.map((pt) => [
    Number((lat0 + pt.y / milesPerLat).toFixed(4)),
    Number((lon0 + pt.x / milesPerLon).toFixed(4)),
  ]);

  return {
    polygon,
    centroid: [Number(lat0.toFixed(4)), Number(lon0.toFixed(4))],
  };
}

function getTodayScheduleColumnIndex(
  days?: Array<{ day: string; date: string }>,
  now = new Date(),
): number {
  if (!days || days.length === 0) return -1;
  const todayStr = now.toLocaleDateString("en-US");
  const exact = days.findIndex((d) => d.date === todayStr);
  if (exact !== -1) return exact;
  const shortDay = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][now.getDay()];
  const byName = days.findIndex((d) => (d.day || "").toUpperCase().startsWith(shortDay));
  if (byName !== -1) return byName;
  // On weekends (Sat/Sun), preview Monday's dispatch column (index 0)
  return 0;
}

export function matchScheduleCellToRoutes(
  cellValue: string,
  territories: RouteTerritoryDefinition[],
): RouteTerritoryDefinition[] {
  const clean = (cellValue || "").trim().toUpperCase();
  if (!clean || clean === "OFF" || clean === "PTO" || clean === "WHS" || clean === "!") {
    return [];
  }

  // 1. Exact scheduleCode match
  const exactMatches = territories.filter((t) =>
    t.scheduleCodes.some((code) => code.toUpperCase() === clean),
  );
  if (exactMatches.length > 0) return exactMatches;

  // 2. Prefix / slash token match (e.g. "HURON / MILLER" or "ABERDEEN-2")
  const tokens = clean
    .split(/[\/,+&]+/)
    .map((tok) => tok.trim())
    .filter(Boolean);

  const matched = new Map<string, RouteTerritoryDefinition>();
  for (const t of territories) {
    for (const code of t.scheduleCodes) {
      const cu = code.toUpperCase();
      if (clean.startsWith(cu) || tokens.includes(cu)) {
        matched.set(t.id, t);
      }
    }
  }
  return Array.from(matched.values());
}

export function lookupKnownTownCoords(
  city: string,
  state?: string,
  extraTerritories?: RouteTerritoryDefinition[] | null,
): { lat: number; lon: number; state: string } | null {
  const cleanCity = String(city || "").trim().toLowerCase();
  const cleanState = String(state || "").trim().toUpperCase();
  if (!cleanCity) return null;

  // Built-in hub & regional out-of-corridor Hot Shot cities first (0ms offline lookup)
  const hubs: Array<{ name: string; state: string; lat: number; lon: number }> = [
    { name: "sioux falls", state: "SD", lat: 43.5446, lon: -96.7311 },
    { name: "arlington", state: "SD", lat: 44.3644, lon: -97.1331 },
    { name: "brookings", state: "SD", lat: 44.3114, lon: -96.7984 },
    { name: "watertown", state: "SD", lat: 44.8994, lon: -97.115 },
    { name: "mitchell", state: "SD", lat: 43.7094, lon: -98.0298 },
    { name: "yankton", state: "SD", lat: 42.8711, lon: -97.3973 },
    { name: "vermillion", state: "SD", lat: 42.7794, lon: -96.9292 },
    { name: "tea", state: "SD", lat: 43.4519, lon: -96.8348 },
    { name: "harrisburg", state: "SD", lat: 43.4319, lon: -96.6973 },
    { name: "brandon", state: "SD", lat: 43.5944, lon: -96.5717 },
    { name: "hartford", state: "SD", lat: 43.623, lon: -96.9425 },
    { name: "dell rapids", state: "SD", lat: 43.8261, lon: -96.7062 },
    { name: "aberdeen", state: "SD", lat: 45.4647, lon: -98.4865 },
    { name: "huron", state: "SD", lat: 44.3633, lon: -98.2143 },
    { name: "pierre", state: "SD", lat: 44.3683, lon: -100.351 },
    { name: "rapid city", state: "SD", lat: 44.0805, lon: -103.231 },
    { name: "spearfish", state: "SD", lat: 44.4908, lon: -103.8594 },
    { name: "chamberlain", state: "SD", lat: 43.8108, lon: -99.3304 },
    { name: "winner", state: "SD", lat: 43.3769, lon: -99.8593 },
    { name: "mobridge", state: "SD", lat: 45.5364, lon: -100.4279 },
    { name: "redfield", state: "SD", lat: 44.8755, lon: -98.5187 },
    { name: "clark", state: "SD", lat: 44.8783, lon: -97.7334 },
    { name: "groton", state: "SD", lat: 45.4461, lon: -98.0976 },
    { name: "webster", state: "SD", lat: 45.3338, lon: -97.5201 },
    { name: "britton", state: "SD", lat: 45.7933, lon: -97.7523 },
    { name: "sisseton", state: "SD", lat: 45.6647, lon: -97.0498 },
    { name: "milbank", state: "SD", lat: 45.2194, lon: -96.6353 },
    { name: "madison", state: "SD", lat: 44.0061, lon: -97.1137 },
    { name: "luverne", state: "MN", lat: 43.6541, lon: -96.2128 },
    { name: "worthington", state: "MN", lat: 43.6199, lon: -95.5964 },
    { name: "marshall", state: "MN", lat: 44.4469, lon: -95.7884 },
    { name: "pipestone", state: "MN", lat: 44.0005, lon: -96.3175 },
    { name: "windom", state: "MN", lat: 43.8664, lon: -95.1169 },
    { name: "jackson", state: "MN", lat: 43.6208, lon: -94.9886 },
    { name: "fairmont", state: "MN", lat: 43.6522, lon: -94.4611 },
    { name: "willmar", state: "MN", lat: 45.1219, lon: -95.0433 },
    { name: "sioux city", state: "IA", lat: 42.4963, lon: -96.4049 },
    { name: "spencer", state: "IA", lat: 43.1414, lon: -95.1444 },
    { name: "spirit lake", state: "IA", lat: 43.4222, lon: -95.1022 },
    { name: "sheldon", state: "IA", lat: 43.1855, lon: -95.8547 },
    { name: "orange city", state: "IA", lat: 43.0055, lon: -96.0584 },
    { name: "fargo", state: "ND", lat: 46.8772, lon: -96.7898 },
    { name: "norfolk", state: "NE", lat: 42.0283, lon: -97.417 },
    { name: "omaha", state: "NE", lat: 41.2565, lon: -95.9345 },
  ];
  for (const h of hubs) {
    if (h.name === cleanCity && (!cleanState || h.state === cleanState)) {
      return { lat: h.lat, lon: h.lon, state: h.state };
    }
  }

  const allTerritories = [
    ...(Array.isArray(extraTerritories) ? extraTerritories : []),
    ...DEFAULT_ROUTE_TERRITORIES,
  ];
  let cityOnlyFallback: { lat: number; lon: number; state: string } | null = null;
  for (const t of allTerritories) {
    for (const s of t.stops || []) {
      if (String(s.name || "").trim().toLowerCase() === cleanCity) {
        if (!cleanState || String(s.state || "").toUpperCase() === cleanState) {
          return { lat: s.lat, lon: s.lon, state: s.state || cleanState || "SD" };
        }
        if (!cityOnlyFallback) {
          cityOnlyFallback = { lat: s.lat, lon: s.lon, state: s.state || "SD" };
        }
      }
    }
  }
  return cityOnlyFallback;
}

export interface ResolveRouteOverlaysOptions {
  filterMode: RouteOverlayFilterMode;
  colorMode?: RouteColorMode;
  selectedRouteIds?: string[];
  activeTruckWeek?: {
    days?: Array<{ day: string; date: string }>;
    rows?: Array<{ driver: string; vehicleKey?: string; color?: string; days?: string[] }>;
  } | null;
  /** Optional pre-built overlays for today's active Hot Shot runs */
  hotShotOverlays?: ResolvedRouteOverlay[];
  now?: Date;
}

export function resolveRouteOverlays(
  rawTerritories: RouteTerritoryDefinition[] | undefined | null,
  options: ResolveRouteOverlaysOptions,
): ResolvedRouteOverlay[] {
  const territories = normalizeRouteTerritories(rawTerritories);
  const {
    filterMode,
    colorMode = "route",
    selectedRouteIds = [],
    activeTruckWeek,
    hotShotOverlays = [],
    now = new Date(),
  } = options;

  if (filterMode === "off") return [];

  if (filterMode === "hotshots_today") {
    return hotShotOverlays;
  }

  if (filterMode === "today") {
    const colIdx = getTodayScheduleColumnIndex(activeTruckWeek?.days, now);
    const byRouteId = new Map<string, ResolvedRouteOverlay>();

    if (colIdx >= 0 && activeTruckWeek?.rows) {
      for (const row of activeTruckWeek.rows) {
        const cell = (row.days?.[colIdx] || "").trim();
        if (!cell) continue;
        const matchedRoutes = matchScheduleCellToRoutes(cell, territories);
        for (const route of matchedRoutes) {
          if (byRouteId.has(route.id)) continue;
          const { polygon, centroid } = computeRouteTerritoryPolygon(route.stops);
          const chosenColor =
            colorMode === "driver" && row.color ? row.color : route.color;
          byRouteId.set(route.id, {
            id: route.id,
            name: route.name,
            truckGroup: route.truckGroup,
            assignedDriver: row.driver,
            scheduleCellText: cell,
            color: chosenColor,
            stops: route.stops,
            polygon,
            centroid,
          });
        }
      }
    }

    return [...Array.from(byRouteId.values()), ...hotShotOverlays];
  }

  let filtered: RouteTerritoryDefinition[] = [];
  if (filterMode === "all") {
    filtered = territories;
  } else if (filterMode === "truck_1") {
    filtered = territories.filter((t) => t.truckGroup.includes("#1"));
  } else if (filterMode === "truck_2") {
    filtered = territories.filter((t) => t.truckGroup.includes("#2"));
  } else if (filterMode === "truck_3") {
    filtered = territories.filter((t) => t.truckGroup.includes("#3"));
  } else if (filterMode === "truck_4") {
    filtered = territories.filter((t) => t.truckGroup.includes("#4"));
  } else if (filterMode === "truck_5") {
    filtered = territories.filter((t) => t.truckGroup.includes("#5"));
  } else if (filterMode === "custom") {
    const idSet = new Set(selectedRouteIds);
    filtered = territories.filter((t) => idSet.has(t.id));
  }

  return filtered.map((route) => {
    const { polygon, centroid } = computeRouteTerritoryPolygon(route.stops);
    return {
      id: route.id,
      name: route.name,
      truckGroup: route.truckGroup,
      assignedDriver: route.defaultDriver,
      color: route.color,
      stops: route.stops,
      polygon,
      centroid,
    };
  });
}
