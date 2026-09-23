export const dashboardHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ARL API Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 p-8 font-sans h-screen flex flex-col">
    <div class="max-w-7xl mx-auto w-full flex flex-col lg:flex-row gap-8 flex-1">
        
        <!-- Left Side: Controls -->
        <div class="flex-1">
            <h1 class="text-3xl font-bold text-green-700 mb-8">ARL Aeroponics API Demo</h1>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <!-- Trays -->
                <div class="bg-white p-6 rounded-lg shadow-md border-t-4 border-blue-500">
                    <h2 class="text-xl font-semibold mb-4">1. Create Tray</h2>
                    <input id="trayCode" type="text" placeholder="Tray Code (e.g. T-01)" class="border p-2 w-full mb-2 rounded">
                    <button onclick="createTray()" class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 w-full">Create Tray</button>
                </div>

                <!-- Batches -->
                <div class="bg-white p-6 rounded-lg shadow-md border-t-4 border-green-500">
                    <h2 class="text-xl font-semibold mb-4">2. Seed Batch</h2>
                    <input id="batchTrayId" type="text" placeholder="Tray ID (UUID)" class="border p-2 w-full mb-2 rounded">
                    <input id="batchCrop" type="text" placeholder="Crop (e.g. Lettuce)" class="border p-2 w-full mb-2 rounded">
                    <button onclick="seedBatch()" class="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 w-full">Seed Batch</button>
                </div>

                <!-- Stage -->
                <div class="bg-white p-6 rounded-lg shadow-md border-t-4 border-yellow-500">
                    <h2 class="text-xl font-semibold mb-4">3. Advance Stage</h2>
                    <input id="stageBatchId" type="text" placeholder="Batch ID (UUID)" class="border p-2 w-full mb-2 rounded">
                    <select id="stageSelect" class="border p-2 w-full mb-2 rounded">
                        <option value="GERMINATION">GERMINATION</option>
                        <option value="GROWING">GROWING</option>
                        <option value="HARVEST_READY">HARVEST_READY</option>
                    </select>
                    <button onclick="advanceStage()" class="bg-yellow-500 text-white px-4 py-2 rounded hover:bg-yellow-600 w-full">Advance Stage</button>
                </div>

                <!-- Harvest -->
                <div class="bg-white p-6 rounded-lg shadow-md border-t-4 border-red-500">
                    <h2 class="text-xl font-semibold mb-4">4. Record Harvest</h2>
                    <input id="harvestBatchId" type="text" placeholder="Batch ID (UUID)" class="border p-2 w-full mb-2 rounded">
                    <input id="harvestWeight" type="number" placeholder="Weight (grams)" class="border p-2 w-full mb-2 rounded">
                    <select id="harvestGrade" class="border p-2 w-full mb-2 rounded">
                        <option value="A">Grade A</option>
                        <option value="B">Grade B</option>
                        <option value="C">Grade C</option>
                    </select>
                    <button onclick="recordHarvest()" class="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 w-full">Record Harvest</button>
                </div>
            </div>
        </div>

        <!-- Right Side: Console -->
        <div class="w-full lg:w-1/3 flex flex-col h-full">
            <h2 class="text-xl font-bold text-gray-700 mb-8 pt-1">Console Logs</h2>
            <div class="flex-1 bg-black text-green-400 p-4 rounded-lg font-mono text-sm overflow-y-auto shadow-inner" style="min-height: 500px;" id="console">
                System Ready. API endpoints standing by...<br>
            </div>
        </div>

    </div>

    <script>
        function log(msg) {
            const el = document.getElementById('console');
            el.innerHTML += '> ' + msg + '<br>';
            el.scrollTop = el.scrollHeight;
        }

        async function createTray() {
            const code = document.getElementById('trayCode').value || 'T-' + Math.floor(Math.random()*1000);
            log('<span class="text-blue-400">POST /trays</span> - ' + code);
            const res = await fetch('/trays', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ code, zone: 'A', capacity_units: 10 })
            });
            const data = await res.json();
            log(JSON.stringify(data, null, 2));
            if(data.id) document.getElementById('batchTrayId').value = data.id;
        }

        async function seedBatch() {
            const tray_id = document.getElementById('batchTrayId').value;
            const crop = document.getElementById('batchCrop').value || 'Lettuce';
            log('<span class="text-green-400">POST /batches</span> - ' + crop);
            const res = await fetch('/batches', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ tray_id, crop })
            });
            const data = await res.json();
            log(JSON.stringify(data, null, 2));
            if(data.id) {
                document.getElementById('stageBatchId').value = data.id;
                document.getElementById('harvestBatchId').value = data.id;
            }
        }

        async function advanceStage() {
            const id = document.getElementById('stageBatchId').value;
            const stage = document.getElementById('stageSelect').value;
            log('<span class="text-yellow-400">PATCH /batches/' + id.substring(0,8) + '.../stage</span> - ' + stage);
            const res = await fetch('/batches/' + id + '/stage', {
                method: 'PATCH',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ stage })
            });
            const data = await res.json();
            log(JSON.stringify(data, null, 2));
        }

        async function recordHarvest() {
            const id = document.getElementById('harvestBatchId').value;
            const weight_grams = parseInt(document.getElementById('harvestWeight').value || '1000');
            const grade = document.getElementById('harvestGrade').value;
            log('<span class="text-red-400">POST /batches/' + id.substring(0,8) + '.../harvest</span>');
            const res = await fetch('/batches/' + id + '/harvest', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ weight_grams, grade })
            });
            const data = await res.json();
            log(JSON.stringify(data, null, 2));
        }
    </script>
</body>
</html>
`;
