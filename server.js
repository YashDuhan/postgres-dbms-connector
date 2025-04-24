require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Default root route
app.get('/', (req, res) => {
  res.json({ test: "ok" });
});

// Store active connections
const connections = {};

// Test database connection
app.post('/api/testConnection', async (req, res) => {
  const { host, port, database, user, password, connectionString } = req.body;
  
  let pool;
  
  // Default SSL configuration that works with most cloud providers
  const sslConfig = {
    rejectUnauthorized: false // Accepts self-signed certificates
  };
  
  try {
    if (connectionString) {
      // If connection string is provided, use it directly
      pool = new Pool({
        connectionString,
        ssl: sslConfig,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });
    } else {
      // Otherwise use individual connection parameters
      pool = new Pool({
        host,
        port: port || 5432,
        database,
        user,
        password,
        ssl: sslConfig,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });
    }

    const client = await pool.connect();
    await client.release();
    
    // Generate connection ID
    const connectionId = Date.now().toString();
    connections[connectionId] = { pool, config: req.body };
    
    res.json({ 
      success: true, 
      message: 'Connection successful',
      connectionId
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Connection failed',
      error: error.message
    });
  }
});

// Get all tables for a connection
app.get('/api/tables/:connectionId', async (req, res) => {
  const { connectionId } = req.params;
  
  if (!connections[connectionId]) {
    return res.status(404).json({
      success: false,
      message: 'Connection not found'
    });
  }
  
  const { pool } = connections[connectionId];
  
  try {
    const client = await pool.connect();
    
    const query = `
      SELECT 
        table_schema, 
        table_name 
      FROM 
        information_schema.tables 
      WHERE 
        table_type = 'BASE TABLE' 
        AND table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY 
        table_schema, 
        table_name;
    `;
    
    const result = await client.query(query);
    client.release();
    
    res.json({
      success: true,
      tables: result.rows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve tables',
      error: error.message
    });
  }
});

// Get table data
app.get('/api/tableData/:connectionId/:schema/:table', async (req, res) => {
  const { connectionId, schema, table } = req.params;
  const { limit = 100, offset = 0 } = req.query;
  
  if (!connections[connectionId]) {
    return res.status(404).json({
      success: false,
      message: 'Connection not found'
    });
  }
  
  const { pool } = connections[connectionId];
  
  try {
    const client = await pool.connect();
    
    // Get columns
    const columnsQuery = `
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position;
    `;
    const columnsResult = await client.query(columnsQuery, [schema, table]);
    
    // Get data
    const dataQuery = `
      SELECT * FROM "${schema}"."${table}"
      LIMIT $1 OFFSET $2;
    `;
    const dataResult = await client.query(dataQuery, [limit, offset]);
    
    // Get count
    const countQuery = `
      SELECT COUNT(*) FROM "${schema}"."${table}";
    `;
    const countResult = await client.query(countQuery);
    
    client.release();
    
    res.json({
      success: true,
      columns: columnsResult.rows,
      data: dataResult.rows,
      total: parseInt(countResult.rows[0].count)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve table data',
      error: error.message
    });
  }
});

// Close connection
app.delete('/api/connections/:connectionId', async (req, res) => {
  const { connectionId } = req.params;
  
  if (!connections[connectionId]) {
    return res.status(404).json({
      success: false,
      message: 'Connection not found'
    });
  }
  
  try {
    const { pool } = connections[connectionId];
    await pool.end();
    delete connections[connectionId];
    
    res.json({
      success: true,
      message: 'Connection closed successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to close connection',
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 