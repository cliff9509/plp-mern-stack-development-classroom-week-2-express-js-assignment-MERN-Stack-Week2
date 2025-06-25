// Load environment variables from .env file
require('dotenv').config();

// Import necessary modules
const express = require('express');
const mongoose = require('mongoose');
const Joi = require('joi'); // Joi for validation

// Create an Express application instance
const app = express();
// Define the port for the server to listen on
const port = 3000;

// --- Custom Error Classes (from Task 4) ---
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

class BadRequestError extends AppError {
  constructor(message = 'Bad Request', errors = []) {
    super(message, 400);
    this.errors = errors;
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

// --- Middleware Definitions (from Task 3) ---

// 1. Custom Logger Middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  next();
});

// 2. JSON Body Parser Middleware
app.use(express.json());

// 3. Authentication Middleware
const authenticateAPIKey = (req, res, next) => {
  const apiKey = req.header('X-API-Key');
  const expectedApiKey = process.env.API_KEY;

  if (!apiKey) {
    return next(new UnauthorizedError('No API Key provided.'));
  }

  if (apiKey !== expectedApiKey) {
    return next(new UnauthorizedError('Invalid API Key.'));
  }

  next();
};

// --- MongoDB Connection Setup (from Task 2) ---

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Error: MONGODB_URI is not defined in the .env file.');
  console.error('Please make sure you have a .env file with MONGODB_URI="your_connection_string"');
  process.exit(1);
}

mongoose.connect(MONGODB_URI)
.then(() => {
  console.log('Connected to MongoDB Atlas!');
})
.catch((error) => {
  console.error('Error connecting to MongoDB:', error.message);
  process.exit(1);
});

// --- Product Schema and Model Definition (from Task 2) ---

const productSchema = new mongoose.Schema({
  id: { type: String, unique: true }, // Added for clarity, though Mongoose uses _id
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  category: {
    type: String,
    trim: true
  },
  inStock: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

productSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const Product = mongoose.model('Product', productSchema);

// --- Joi Validation Schemas (from Task 3) ---

const createProductSchema = Joi.object({
  name: Joi.string().trim().required(),
  description: Joi.string().trim().allow('').optional(),
  price: Joi.number().min(0).required(),
  category: Joi.string().trim().allow('').optional(),
  inStock: Joi.boolean().optional()
});

const updateProductSchema = Joi.object({
  name: Joi.string().trim().optional(),
  description: Joi.string().trim().allow('').optional(),
  price: Joi.number().min(0).optional(),
  category: Joi.string().trim().allow('').optional(),
  inStock: Joi.boolean().optional()
}).min(1);

// 4. Validation Middleware Functions (from Task 3)
const validate = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body, { abortEarly: false });
  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message
    }));
    return next(new BadRequestError('Validation failed', errors));
  }
  next();
};

// --- RESTful API Routes for Products (with Advanced Features) ---

// GET /api/products: List all products with filtering and pagination
app.get('/api/products', async (req, res, next) => {
  try {
    const { category, page = 1, limit = 10 } = req.query; // Default page to 1, limit to 10

    const query = {};
    if (category) {
      query.category = new RegExp(category, 'i'); // Case-insensitive category filter
    }

    // Convert page and limit to numbers
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    // Basic validation for page and limit
    if (isNaN(pageNum) || pageNum < 1) {
      return next(new BadRequestError('Invalid page number. Page must be a positive integer.'));
    }
    if (isNaN(limitNum) || limitNum < 1) {
      return next(new BadRequestError('Invalid limit. Limit must be a positive integer.'));
    }

    const skip = (pageNum - 1) * limitNum;

    const totalProducts = await Product.countDocuments(query);
    const products = await Product.find(query)
      .skip(skip)
      .limit(limitNum);

    const totalPages = Math.ceil(totalProducts / limitNum);

    res.status(200).json({
      products,
      currentPage: pageNum,
      totalPages,
      totalProducts
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/products/search: Search products by name
app.get('/api/products/search', async (req, res, next) => {
  try {
    const { q } = req.query; // Search query parameter

    if (!q) {
      return next(new BadRequestError('Search query (q) parameter is required.'));
    }

    // Use a regular expression for case-insensitive partial match on name
    const products = await Product.find({
      name: { $regex: q, $options: 'i' } // 'i' for case-insensitive
    });

    res.status(200).json(products);
  } catch (error) {
    next(error);
  }
});

// GET /api/products/stats: Get product statistics (e.g., count by category)
app.get('/api/products/stats', async (req, res, next) => {
  try {
    const stats = await Product.aggregate([
      {
        // Group by category field. If a product has no category, it will be grouped under null.
        $group: {
          _id: '$category', // Group by the 'category' field
          count: { $sum: 1 }, // Count the number of products in each group
          averagePrice: { $avg: '$price' }, // Calculate average price per category
          minPrice: { $min: '$price' },
          maxPrice: { $max: '$price' }
        }
      },
      {
        // Sort the results by count in descending order
        $sort: { count: -1 }
      }
    ]);

    res.status(200).json(stats);
  } catch (error) {
    next(error);
  }
});

// GET /api/products/:id: Get a specific product by ID
app.get('/api/products/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);

    if (!product) {
      return next(new NotFoundError('Product not found'));
    }
    res.status(200).json(product);
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
      return next(new BadRequestError('Invalid ID format.'));
    }
    next(error);
  }
});

// POST /api/products: Create a new product
app.post('/api/products', authenticateAPIKey, validate(createProductSchema), async (req, res, next) => {
  try {
    const newProduct = new Product(req.body);
    const savedProduct = await newProduct.save();
    res.status(201).json(savedProduct);
  } catch (error) {
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(el => ({
        field: el.path,
        message: el.message
      }));
      return next(new BadRequestError('Database validation failed', errors));
    }
    next(error);
  }
});

// PUT /api/products/:id: Update an existing product
app.put('/api/products/:id', authenticateAPIKey, validate(updateProductSchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const updatedProduct = await Product.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });

    if (!updatedProduct) {
      return next(new NotFoundError('Product not found'));
    }
    res.status(200).json(updatedProduct);
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
      return next(new BadRequestError('Invalid ID format.'));
    }
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(el => ({
        field: el.path,
        message: el.message
      }));
      return next(new BadRequestError('Database validation failed', errors));
    }
    next(error);
  }
});

// DELETE /api/products/:id: Delete a product
app.delete('/api/products/:id', authenticateAPIKey, async (req, res, next) => {
  try {
    const { id } = req.params;
    const deletedProduct = await Product.findByIdAndDelete(id);

    if (!deletedProduct) {
      return next(new NotFoundError('Product not found'));
    }
    res.status(200).json({ message: 'Product deleted successfully', deletedProduct });
  } catch (error) {
    if (error.name === 'CastError' && error.kind === 'ObjectId') {
      return next(new BadRequestError('Invalid ID format.'));
    }
    next(error);
  }
});

// --- Global Error Handling Middleware (MUST be last, from Task 4) ---
app.use((err, req, res, next) => {
  console.error('--- GLOBAL ERROR HANDLER ---');
  console.error(err);
  console.error('--- END GLOBAL ERROR HANDLER ---');

  let statusCode = 500;
  let message = 'Something went wrong!';
  let errors = [];

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    if (err instanceof BadRequestError && err.errors.length > 0) {
      errors = err.errors;
    }
  } else if (err.name === 'CastError' && err.kind === 'ObjectId') {
    statusCode = 400;
    message = 'Invalid ID format.';
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Database validation failed';
    errors = Object.values(err.errors).map(el => ({
      field: el.path,
      message: el.message
    }));
  } else if (err.code === 11000) {
    statusCode = 409;
    message = `Duplicate field value: ${Object.keys(err.keyValue)[0]}. Please use another value.`;
  }

  res.status(statusCode).json({
    status: 'error',
    message: message,
    errors: errors.length > 0 ? errors : undefined,
  });
});

// --- Server Start ---

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
