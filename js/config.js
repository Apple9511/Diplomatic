const GAME_CONFIG = {
    STARTING_LIVES: 3,
    MAX_LIVES: 4,
    BASE_GOLD_PER_DAY: 1,
    BASE_ACTIONS_PER_DAY: 1,
    UPGRADE_POINTS_PER_ACTION: 1,
    UPGRADE_WEEKLY_DECAY: 1,
    
    UPGRADE_REQUIREMENTS: {
        2: 3,  // Level 2 needs 3 upgrade points
        3: 4,  // Level 3 needs 4 upgrade points
        4: 5   // Level 4 needs 5 upgrade points
    },
    
    ECONOMIC_BONUSES: {
        2: { goldPerDay: 0.5 },
        3: { goldPerDay: 0.5 }, // Cumulative: level 3 gets +1 total (base 1 + 0.5 + 0.5)
        4: { fortifyCost: 2 }    // Level 4: fortify costs 2 gold
    },
    
    WARTIME_BONUSES: {
        2: { canRerollAttack: true },
        3: { soldierCost: 1.5 },
        4: { goldToAction: 4 }    // Transform 4 gold into 1 action
    }
};

// Sample neighboring relationships (will be expanded based on actual countries)
const NEIGHBORING_COUNTRIES = {}; // Will be populated dynamically