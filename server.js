const express = require('express');
const { DefaultAzureCredential } = require('@azure/identity');
const { CostManagementClient } = require('@azure/arm-costmanagement');
const { CosmosClient } = require('@azure/cosmos');
const app = express();
const port = process.env.PORT || 3000;

// Azure SDK configuration
const credential = new DefaultAzureCredential();
const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID || 'YOUR_SUBSCRIPTION_ID';
const costClient = new CostManagementClient(credential, subscriptionId);

// Cosmos DB configuration
const cosmosEndpoint = process.env.COSMOS_ENDPOINT || 'YOUR_COSMOS_ENDPOINT';
const cosmosKey = process.env.COSMOS_KEY || 'YOUR_COSMOS_KEY';
const cosmosClient = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
const databaseId = 'CloudSaverDB';
const containerId = 'CostData';

// Middleware for tenant authentication (Azure SaaS Development Kit)
app.use(async (req, res, next) => {
  try {
    req.tenantId = req.headers['x-tenant-id'] || 'default-tenant';
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
});

// API to fetch, analyze, and store Azure costs
app.get('/api/cost-analysis', async (req, res) => {
  try {
    // Fetch cost data
    const query = {
      type: 'Usage',
      timeframe: 'MonthToDate',
      dataset: {
        granularity: 'Daily',
        aggregation: { totalCost: { name: 'Cost', function: 'Sum' } }
      }
    };
    const result = await costClient.query.usage(`subscriptions/${subscriptionId}`, query);

    // Analyze costs
    const costData = result.rows.map(row => ({
      date: row[1],
      cost: row[0],
      resource: row[2],
      tenantId: req.tenantId
    }));

    // Generate recommendations
    const recommendations = costData.map(data => {
      if (data.cost > 100) {
        return `High cost for ${data.resource}. Consider resizing or scheduling shutdown.`;
      }
      return null;
    }).filter(Boolean);

    // Store in Cosmos DB
    const database = cosmosClient.database(databaseId);
    const container = database.container(containerId);
    for (const data of costData) {
      await container.items.upsert({
        id: `${data.tenantId}_${data.date}_${data.resource}`,
        ...data,
        recommendations: recommendations.filter(r => r.includes(data.resource))
      });
    }

    res.json({ costs: costData, recommendations });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to process cost data' });
  }
});

// Start server
app.listen(port, () => {
  console.log(`CloudSaver backend running on port ${port}`);
});
