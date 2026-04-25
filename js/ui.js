// ui.js
document.addEventListener('DOMContentLoaded', () => {
    console.log('UI.js loaded');
    
    // Wait a moment for game to be initialized
    setTimeout(() => {
        initializeUI();
    }, 100);
});

function initializeUI() {
    console.log('Initializing UI, game exists:', !!window.game);
    
    // Country creation form
    const creationForm = document.getElementById('countryCreationForm');
    if (creationForm) {
        creationForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            if (!window.game) {
                alert('Game not initialized yet. Please refresh the page.');
                return;
            }
            
            const countryData = {
                name: document.getElementById('countryName').value,
                type: document.getElementById('countryType').value
            };
            
            await window.game.createCountry(countryData);
        });
    }
    
    // Action buttons
    const buySoldierBtn = document.getElementById('buySoldier');
    if (buySoldierBtn) {
        buySoldierBtn.addEventListener('click', () => {
            if (window.game) window.game.buySoldier();
            else alert('Game not initialized');
        });
    }
    
    const fortifyBtn = document.getElementById('fortify');
    if (fortifyBtn) {
        fortifyBtn.addEventListener('click', () => {
            if (window.game) window.game.fortify();
            else alert('Game not initialized');
        });
    }
    
    const upgradeBtn = document.getElementById('upgrade');
    if (upgradeBtn) {
        upgradeBtn.addEventListener('click', () => {
            if (window.game) window.game.upgrade();
            else alert('Game not initialized');
        });
    }
    
    // Heal neighbor button
    const healNeighborBtn = document.getElementById('healNeighbor');
    if (healNeighborBtn) {
        healNeighborBtn.addEventListener('click', async () => {
            if (!window.game) {
                alert('Game not initialized');
                return;
            }
            const neighborId = prompt('Enter neighbor country ID to heal:');
            if (neighborId) {
                await window.game.fortify(neighborId);
            }
        });
    }
    
    // Attack button
    const attackBtn = document.getElementById('attackBtn');
    if (attackBtn) {
        attackBtn.addEventListener('click', async () => {
            if (!window.game) {
                alert('Game not initialized');
                return;
            }
            const neighborId = document.getElementById('neighborSelect')?.value;
            if (neighborId) {
                await window.game.attack(neighborId);
            } else {
                alert('Please select a neighbor to attack');
            }
        });
    }
    
    // Trade button
    const proposeTradeBtn = document.getElementById('proposeTrade');
    if (proposeTradeBtn) {
        proposeTradeBtn.addEventListener('click', async () => {
            if (!window.game) {
                alert('Game not initialized');
                return;
            }
            
            const partnerSelect = document.getElementById('tradePartner');
            const partnerId = partnerSelect?.value;
            
            if (!partnerId) {
                alert('Please select a trade partner');
                return;
            }
            
            // Get the selected option text to extract name (optional)
            const selectedOption = partnerSelect.options[partnerSelect.selectedIndex];
            const partnerName = selectedOption ? selectedOption.text.split(' (')[0] : 'player';
            
            const tradeData = {
                partnerId: partnerId,
                partnerName: partnerName,
                gold: parseInt(document.getElementById('tradeGold')?.value) || 0,
                soldiers: parseInt(document.getElementById('tradeSoldiers')?.value) || 0,
                actions: parseInt(document.getElementById('tradeActions')?.value) || 0
            };
            
            if (tradeData.gold === 0 && tradeData.soldiers === 0 && tradeData.actions === 0) {
                alert('Please enter at least one resource to trade');
                return;
            }
            
            await window.game.proposeTrade(tradeData);
        });
    }
}

// Make functions globally available for inline onclick handlers
window.acceptTrade = function(tradeId) {
    if (window.game) {
        window.game.acceptTrade(tradeId);
    } else {
        console.error('Game not initialized');
        alert('Game not initialized. Please refresh.');
    }
};

window.rejectTrade = function(tradeId) {
    if (window.game) {
        window.game.rejectTrade(tradeId);
    } else {
        console.error('Game not initialized');
        alert('Game not initialized. Please refresh.');
    }
};

window.cancelTrade = function(tradeId) {
    if (window.game) {
        window.game.cancelTrade(tradeId);
    } else {
        console.error('Game not initialized');
        alert('Game not initialized. Please refresh.');
    }
};