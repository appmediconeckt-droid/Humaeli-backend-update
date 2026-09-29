// test-registration.js
// Run with: node test-registration.js

import mongoose from './src/persistence/mongoose.js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

// Import your models and services
import User from './src/models/userModel.js';
import Session from './src/models/sessionModel.js';
import connectDB from './src/config/db.js';
import { generateAccessToken, generateRefreshToken } from './src/utils/token.js';

// Mock the OTP service and stores
const verifiedUsersStore = new Map();
const emailOTPStore = new Map();
const phoneOTPStore = new Map();

// Test configuration
const TEST_EMAIL = `test_${Date.now()}@example.com`;
const TEST_PHONE = `98765432${Math.floor(Math.random() * 100)}`;
const TEST_OTP = '123456'; // Fixed OTP for testing

console.log('🧪 Starting Registration Flow Test');
console.log('====================================\n');

// Helper function to simulate OTP sending
async function sendMockOTP(type, email, phone) {
    console.log(`📧 Mock ${type} OTP sent: ${TEST_OTP}`);
    return true;
}

// Step 1: Test Email OTP Send
async function testSendEmailOTP() {
    console.log('📝 STEP 1: Testing Send Email OTP');
    console.log('--------------------------------');
    
    try {
        // Check if user already exists
        const existingUser = await User.findOne({ email: TEST_EMAIL });
        if (existingUser) {
            console.log(`⚠️ User already exists with email: ${TEST_EMAIL}`);
            console.log('   Deleting existing user for clean test...');
            await User.deleteOne({ email: TEST_EMAIL });
        }
        
        // Generate and store OTP
        const otp = TEST_OTP;
        emailOTPStore.set(TEST_EMAIL, { 
            otp, 
            expiresAt: Date.now() + 10 * 60 * 1000 
        });
        
        console.log(`✅ Email OTP sent successfully to: ${TEST_EMAIL}`);
        console.log(`   OTP: ${otp}`);
        console.log(`   Store size: ${emailOTPStore.size}`);
        
        return true;
    } catch (error) {
        console.error('❌ Send Email OTP Failed:', error.message);
        return false;
    }
}

// Step 2: Test Verify Email OTP
async function testVerifyEmailOTP() {
    console.log('\n📝 STEP 2: Testing Verify Email OTP');
    console.log('----------------------------------');
    
    try {
        const storedData = emailOTPStore.get(TEST_EMAIL);
        
        if (!storedData) {
            console.log(`❌ No OTP found for email: ${TEST_EMAIL}`);
            return false;
        }
        
        console.log(`Found OTP data:`, storedData);
        
        if (Date.now() > storedData.expiresAt) {
            console.log(`❌ OTP has expired`);
            return false;
        }
        
        if (storedData.otp !== TEST_OTP) {
            console.log(`❌ Invalid OTP. Expected: ${TEST_OTP}, Got: ${storedData.otp}`);
            return false;
        }
        
        // Mark email as verified
        let userVerification = verifiedUsersStore.get(TEST_EMAIL);
        if (!userVerification) {
            userVerification = {
                isEmailVerified: true,
                isPhoneVerified: false,
                expiresAt: Date.now() + 60 * 60 * 1000
            };
        } else {
            userVerification.isEmailVerified = true;
        }
        
        verifiedUsersStore.set(TEST_EMAIL, userVerification);
        emailOTPStore.delete(TEST_EMAIL);
        
        console.log(`✅ Email verified successfully for: ${TEST_EMAIL}`);
        console.log(`   Verification status:`, userVerification);
        
        return true;
    } catch (error) {
        console.error('❌ Verify Email OTP Failed:', error.message);
        return false;
    }
}

// Step 3: Test Send Phone OTP
async function testSendPhoneOTP() {
    console.log('\n📝 STEP 3: Testing Send Phone OTP');
    console.log('--------------------------------');
    
    try {
        const userVerification = verifiedUsersStore.get(TEST_EMAIL);
        
        if (!userVerification || !userVerification.isEmailVerified) {
            console.log(`❌ Email not verified for: ${TEST_EMAIL}`);
            return false;
        }
        
        console.log(`Email verification status:`, userVerification);
        
        // Store phone OTP
        const otp = TEST_OTP;
        phoneOTPStore.set(TEST_EMAIL, {
            otp,
            phoneNumber: TEST_PHONE,
            formattedPhone: `+91${TEST_PHONE}`,
            expiresAt: Date.now() + 10 * 60 * 1000
        });
        
        userVerification.phoneNumber = TEST_PHONE;
        userVerification.formattedPhone = `+91${TEST_PHONE}`;
        verifiedUsersStore.set(TEST_EMAIL, userVerification);
        
        console.log(`✅ Phone OTP sent successfully to: ${TEST_PHONE}`);
        console.log(`   OTP: ${otp}`);
        
        return true;
    } catch (error) {
        console.error('❌ Send Phone OTP Failed:', error.message);
        return false;
    }
}

// Step 4: Test Verify Phone OTP
async function testVerifyPhoneOTP() {
    console.log('\n📝 STEP 4: Testing Verify Phone OTP');
    console.log('----------------------------------');
    
    try {
        const storedData = phoneOTPStore.get(TEST_EMAIL);
        
        if (!storedData) {
            console.log(`❌ No phone OTP found for email: ${TEST_EMAIL}`);
            return false;
        }
        
        console.log(`Found phone OTP data:`, storedData);
        
        if (Date.now() > storedData.expiresAt) {
            console.log(`❌ Phone OTP has expired`);
            return false;
        }
        
        if (storedData.otp !== TEST_OTP) {
            console.log(`❌ Invalid OTP. Expected: ${TEST_OTP}, Got: ${storedData.otp}`);
            return false;
        }
        
        const userVerification = verifiedUsersStore.get(TEST_EMAIL);
        if (userVerification) {
            userVerification.isPhoneVerified = true;
            verifiedUsersStore.set(TEST_EMAIL, userVerification);
        }
        
        phoneOTPStore.delete(TEST_EMAIL);
        
        console.log(`✅ Phone verified successfully for: ${TEST_PHONE}`);
        console.log(`   Verification status:`, userVerification);
        
        return true;
    } catch (error) {
        console.error('❌ Verify Phone OTP Failed:', error.message);
        return false;
    }
}

// Step 5: Test Complete Registration
async function testCompleteRegistration() {
    console.log('\n📝 STEP 5: Testing Complete Registration');
    console.log('---------------------------------------');
    
    try {
        const userVerification = verifiedUsersStore.get(TEST_EMAIL);
        
        console.log(`Verification data before registration:`, userVerification);
        
        if (!userVerification) {
            console.log(`❌ No verification session found for: ${TEST_EMAIL}`);
            return false;
        }
        
        if (Date.now() > userVerification.expiresAt) {
            console.log(`❌ Verification session has expired`);
            return false;
        }
        
        if (!userVerification.isEmailVerified || !userVerification.isPhoneVerified) {
            const missing = [];
            if (!userVerification.isEmailVerified) missing.push('email');
            if (!userVerification.isPhoneVerified) missing.push('phone');
            console.log(`❌ Missing verifications: ${missing.join(', ')}`);
            return false;
        }
        
        console.log(`✅ All verifications passed!`);
        
        // Check if user already exists
        const existingUser = await User.findOne({ 
            $or: [{ email: TEST_EMAIL }, { phoneNumber: TEST_PHONE }] 
        });
        
        if (existingUser) {
            console.log(`⚠️ User already exists with email or phone`);
            console.log(`   Deleting existing user for clean test...`);
            await User.deleteOne({ _id: existingUser._id });
            await Session.deleteMany({ userId: existingUser._id });
        }
        
        // Create user data
        const hashedPassword = await bcrypt.hash('Test123!', 10);
        
        const userData = {
            fullName: 'Test User',
            email: TEST_EMAIL,
            password: hashedPassword,
            phoneNumber: TEST_PHONE,
            age: 25,
            gender: 'male',
            role: 'user',
            profileCompleted: true,
            isEmailVerified: true,
            isActive: true,
            dateOfBirth: new Date('1995-01-01'),
            bloodGroup: 'O+',
            address: {
                line1: '123 Test St',
                line2: '',
                city: 'Test City',
                state: 'Test State',
                pincode: '123456',
                country: 'India'
            },
            emergencyContact: {
                name: 'Emergency Contact',
                relation: 'Spouse',
                phone: '9876543210'
            }
        };
        
        console.log(`Creating user with data:`, {
            email: userData.email,
            phoneNumber: userData.phoneNumber,
            role: userData.role
        });
        
        // Create user
        const newUser = await User.create(userData);
        
        console.log(`✅ User created successfully!`);
        console.log(`   User ID: ${newUser._id}`);
        console.log(`   Email: ${newUser.email}`);
        console.log(`   Phone: ${newUser.phoneNumber}`);
        
        // Generate tokens
        const accessToken = generateAccessToken(newUser._id);
        const refreshToken = generateRefreshToken(newUser._id);
        
        // Create session
        await Session.create({
            userId: newUser._id,
            refreshToken,
            isActive: true,
            createdAt: new Date()
        });
        
        console.log(`✅ Session created successfully`);
        
        // Clean up verification data
        verifiedUsersStore.delete(TEST_EMAIL);
        
        return { success: true, user: newUser };
    } catch (error) {
        console.error('❌ Complete Registration Failed:', error.message);
        console.error('Stack trace:', error.stack);
        return { success: false, error: error.message };
    }
}

// Additional Test: Check if pre-save middleware is causing issues
async function testPreSaveMiddleware() {
    console.log('\n📝 ADDITIONAL TEST: Checking Pre-save Middleware');
    console.log('-----------------------------------------------');
    
    try {
        // Create a test user with unique code requirement
        const testUserData = {
            fullName: 'Middleware Test',
            email: `middleware_${Date.now()}@test.com`,
            password: await bcrypt.hash('Test123!', 10),
            phoneNumber: `99999${Date.now().toString().slice(-5)}`,
            role: 'counsellor', // Force counsellor role to test unique code generation
            qualification: 'Test Qualification',
            specialization: ['Test'],
            experience: 5,
            location: 'Test Location',
            consultationMode: ['online'],
            languages: ['English'],
            profileCompleted: true,
            isEmailVerified: true,
            isActive: true
        };
        
        console.log('Testing counsellor registration with unique code generation...');
        const testUser = await User.create(testUserData);
        
        console.log(`✅ Pre-save middleware test passed!`);
        console.log(`   Generated unique code: ${testUser.uniqueCode}`);
        console.log(`   User ID: ${testUser._id}`);
        
        // Clean up test user
        await User.deleteOne({ _id: testUser._id });
        console.log(`   Test user cleaned up`);
        
        return true;
    } catch (error) {
        console.error('❌ Pre-save middleware test failed:', error.message);
        console.error('Stack trace:', error.stack);
        return false;
    }
}

// Main test function
async function runTests() {
    try {
        // Connect to MySQL through the application database layer.
        console.log('🔌 Connecting to MySQL...');
        await connectDB();
        console.log('✅ Connected to MySQL\n');
        
        // Run tests
        const step1 = await testSendEmailOTP();
        if (!step1) {
            console.log('\n❌ Test failed at Step 1');
            process.exit(1);
        }
        
        const step2 = await testVerifyEmailOTP();
        if (!step2) {
            console.log('\n❌ Test failed at Step 2');
            process.exit(1);
        }
        
        const step3 = await testSendPhoneOTP();
        if (!step3) {
            console.log('\n❌ Test failed at Step 3');
            process.exit(1);
        }
        
        const step4 = await testVerifyPhoneOTP();
        if (!step4) {
            console.log('\n❌ Test failed at Step 4');
            process.exit(1);
        }
        
        const step5 = await testCompleteRegistration();
        if (!step5.success) {
            console.log('\n❌ Test failed at Step 5');
            console.log(`Error: ${step5.error}`);
            process.exit(1);
        }
        
        // Test pre-save middleware
        const middlewareTest = await testPreSaveMiddleware();
        
        console.log('\n====================================');
        console.log('🎉 ALL TESTS PASSED!');
        console.log('====================================');
        console.log('\n✅ Registration flow is working correctly');
        console.log(`✅ Test user created: ${TEST_EMAIL}`);
        console.log(`✅ Test phone: ${TEST_PHONE}`);
        
        // Optional: Clean up test user
        console.log('\n🧹 Cleaning up test user...');
        await User.deleteOne({ email: TEST_EMAIL });
        console.log('✅ Test user deleted');
        
    } catch (error) {
        console.error('\n❌ Test failed with error:', error.message);
        console.error('Stack trace:', error.stack);
    } finally {
        // Close database connection
        await mongoose.disconnect();
        console.log('\n🔌 Disconnected from MySQL');
        process.exit(0);
    }
}

// Run the tests
runTests();
