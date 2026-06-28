const express = require('express');
const { Client } = require('@elastic/elasticsearch');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// Host the frontend assets statically from the root directory
app.use(express.static(__dirname));

// Use environment variable for Elastic node (configured via docker-compose)
const ES_NODE = process.env.ES_NODE || 'http://localhost:9200';
const client = new Client({ 
  node: ES_NODE,
  tls: {
    rejectUnauthorized: false 
  }
}); 
const INDEX_NAME = 'products';

// Initialize Index with Search-as-you-type autocomplete mappings
async function initIndex() {
  try {
    const exists = await client.indices.exists({ index: INDEX_NAME });
    if (!exists) {
      await client.indices.create({
        index: INDEX_NAME,
        body: {
          mappings: {
            properties: {
              title: { 
                type: 'text',
                fields: {
                  suggest: { type: 'search_as_you_type' } 
                }
              },
              description: { type: 'text' },
              price: { type: 'float' }
            }
          }
        }
      });
      console.log(`Index "${INDEX_NAME}" created successfully.`);
    }
  } catch (err) {
    console.error('Error initializing Elasticsearch index:', err.message);
  }
}
initIndex();

// Serve the index.html on the base route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// POST: Index a new product document
app.post('/api/products', async (req, res) => {
  try {
    const { title, description, price } = req.body;
    const response = await client.index({
      index: INDEX_NAME,
      body: { title, description, price }
    });
    await client.indices.refresh({ index: INDEX_NAME });
    res.status(201).json({ message: 'Product indexed!', id: response._id });
  } catch (error) {
    console.error('FULL ELASTIC ERROR DETECTED:', JSON.stringify(error, null, 2));
    console.error('Error message:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET: Fetch a single document by its ID
app.get('/api/products/:id', async (req, res) => {
  try {
    const response = await client.get({
      index: INDEX_NAME,
      id: req.params.id
    });
    res.json(response._source);
  } catch (error) {
    res.status(404).json({ error: 'Product not found' });
  }
});

// GET (Search): Full-text search
app.get('/api/search', async (req, res) => {
  try {
    const { q } = req.query;
    const response = await client.search({
      index: INDEX_NAME,
      body: {
        query: {
          multi_match: {
            query: q,
            fields: ['title', 'description']
          }
        }
      }
    });
    const results = response.hits.hits.map(hit => ({ id: hit._id, ...hit._source }));
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET (Suggest): Dynamic type-ahead recommendations
app.get('/api/suggest', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);

    const response = await client.search({
      index: INDEX_NAME,
      body: {
        query: {
          multi_match: {
            query: q,
            type: 'bool_prefix',
            fields: ['title.suggest', 'title.suggest._2gram', 'title.suggest._3gram']
          }
        }
      }
    });
    const suggestions = response.hits.hits.map(hit => hit._source.title);
    res.json([...new Set(suggestions)]); 
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));