import dotenv from 'dotenv';
import connectDB from '../config/database.js';
import User from '../models/User.js';
import { ROLES } from '../config/constants.js';

dotenv.config();

const seedAdmin = async () => {
  try {
    await connectDB();
    console.log('MongoDB connected');

    // Check if admin exists
    const adminExists = await User.findOne({ role: ROLES.ADMIN });

    if (adminExists) {
      console.log('Admin user already exists');
      console.log('Email:', adminExists.email);
      process.exit(0);
    }

    // Create admin user
    const admin = await User.create({
      email: 'admin@example.com',
      password: 'Admin@123',
      name: 'Admin User',
      role: ROLES.ADMIN,
      isActive: true
    });

    console.log('✅ Admin user created successfully!');
    console.log('Email: admin@example.com');
    console.log('Password: Admin@123');
    console.log('\n⚠️  Please change the password after first login!');

    process.exit(0);
  } catch (error) {
    console.error('Error seeding admin:', error);
    process.exit(1);
  }
};

seedAdmin();
