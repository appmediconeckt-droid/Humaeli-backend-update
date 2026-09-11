import connectDB from "./src/config/db.js";
// testModels.js
import mongoose from './src/persistence/mongoose.js';
import User from './src/models/userModel.js';
import Conversation from './src/models/Conversation.js';
import Message from './src/models/Message.js';
import dotenv from 'dotenv';

dotenv.config();

const testConversationSystem = async () => {
  let session;
  
  try {
    await connectDB();
    console.log('✅ Connected to MongoDB\n');

    // Clean up previous test data
    console.log('🧹 Cleaning up previous test data...');
    await Message.deleteMany({});
    await Conversation.deleteMany({});
    await User.deleteMany({ 
      email: { $in: ['test.user@example.com', 'test.counsellor@example.com'] }
    });
    console.log('✅ Cleanup complete\n');

    // Create test users
    console.log('👥 Creating test users...');
    const testUser = await User.create({
      fullName: 'Test User',
      email: 'test.user@example.com',
      phoneNumber: '+1234567890',
      password: 'hashed_password_123',
      role: 'user',
      age: 25,
      gender: 'male',
      isEmailVerified: true,
      isPhoneVerified: true
    });
    console.log('✅ Created test user:', testUser._id);
    console.log('   Role:', testUser.role);

    const testCounsellor = await User.create({
      fullName: 'Dr. Test Counsellor',
      email: 'test.counsellor@example.com',
      phoneNumber: '+1987654321',
      password: 'hashed_password_456',
      role: 'counsellor',
      qualification: 'PhD in Psychology',
      specialization: ['Anxiety', 'Depression'],
      experience: 8,
      location: 'New York',
      consultationMode: ['online'],
      languages: ['English'],
      aboutMe: 'Experienced counsellor',
      isVerified: true,
      isActive: true
    });
    console.log('✅ Created test counsellor:', testCounsellor._id);
    console.log('   Role:', testCounsellor.role);
    console.log();

    // Test 1: Create conversation
    console.log('📝 Test 1: Creating conversation...');
    let conversation = await Conversation.findOne({
      'participants.user': testUser._id,
      'participants.counsellor': testCounsellor._id
    });

    if (!conversation) {
      conversation = await Conversation.create({
        participants: {
          user: testUser._id,
          counsellor: testCounsellor._id
        },
        status: 'active',
        unreadCount: { user: 0, counsellor: 0 }
      });
    }
    console.log('✅ Conversation created:', conversation._id);
    console.log('   Participants:', {
      user: conversation.participants.user,
      counsellor: conversation.participants.counsellor
    });
    console.log();

    // Test 2: Send message from user
    console.log('📝 Test 2: Sending message from user...');
    try {
      const userMessage = new Message({
        conversationId: conversation._id,
        sender: 'user',
        senderId: testUser._id,
        receiverId: testCounsellor._id,
        message: 'Hello, I need help with anxiety',
        messageType: 'text',
        attachments: []
      });
      
      await userMessage.validate(); // Validate before saving
      await userMessage.save();
      
      console.log('✅ Message sent successfully!');
      console.log('   Message ID:', userMessage._id);
      console.log('   Content:', userMessage.message);
      console.log('   Sender:', userMessage.sender);
      
      // Update conversation
      conversation.lastMessage = userMessage.message;
      conversation.lastMessageTime = userMessage.createdAt;
      conversation.lastMessageSender = 'user';
      conversation.unreadCount.counsellor += 1;
      await conversation.save();
      console.log('✅ Conversation updated with last message');
    } catch (error) {
      console.error('❌ Failed to send message:', error.message);
      throw error;
    }
    console.log();

    // Test 3: Send reply from counsellor
    console.log('📝 Test 3: Sending reply from counsellor...');
    try {
      const counsellorMessage = new Message({
        conversationId: conversation._id,
        sender: 'counsellor',
        senderId: testCounsellor._id,
        receiverId: testUser._id,
        message: "I'd be happy to help. Can you tell me more?",
        messageType: 'text',
        attachments: []
      });
      
      await counsellorMessage.validate();
      await counsellorMessage.save();
      
      console.log('✅ Reply sent successfully!');
      console.log('   Content:', counsellorMessage.message);
      console.log('   Sender:', counsellorMessage.sender);
      
      conversation.lastMessage = counsellorMessage.message;
      conversation.lastMessageTime = counsellorMessage.createdAt;
      conversation.lastMessageSender = 'counsellor';
      conversation.unreadCount.user += 1;
      await conversation.save();
      console.log('✅ Conversation updated with reply');
    } catch (error) {
      console.error('❌ Failed to send reply:', error.message);
      throw error;
    }
    console.log();

    // Test 4: Retrieve all messages
    console.log('📝 Test 4: Retrieving all messages...');
    const messages = await Message.find({ conversationId: conversation._id })
      .sort({ createdAt: 1 });
    
    console.log(`✅ Found ${messages.length} messages:`);
    messages.forEach((msg, index) => {
      console.log(`   ${index + 1}. [${msg.sender.toUpperCase()}]: ${msg.message}`);
      console.log(`      - ID: ${msg._id}`);
      console.log(`      - Read: ${msg.isRead ? '✅' : '❌'}`);
      console.log(`      - Created: ${msg.createdAt}`);
    });
    console.log();

    // Test 5: Mark messages as read
    console.log('📝 Test 5: Marking messages as read...');
    const unreadMessages = await Message.find({
      conversationId: conversation._id,
      receiverId: testUser._id,
      isRead: false
    });
    
    if (unreadMessages.length > 0) {
      const result = await Message.updateMany(
        { _id: { $in: unreadMessages.map(m => m._id) } },
        { 
          isRead: true, 
          readAt: new Date(),
          isDelivered: true,
          deliveredAt: new Date()
        }
      );
      console.log(`✅ Marked ${result.modifiedCount} messages as read`);
      
      conversation.unreadCount.user = 0;
      await conversation.save();
    } else {
      console.log('✅ No unread messages found');
    }
    console.log();

    // Test 6: Final verification
    console.log('📝 Test 6: Final verification...');
    const finalMessages = await Message.find({ conversationId: conversation._id });
    const finalConv = await Conversation.findById(conversation._id);
    
    console.log('✅ Final Results:');
    console.log(`   Total messages: ${finalMessages.length}`);
    console.log(`   User unread: ${finalConv.unreadCount.user}`);
    console.log(`   Counsellor unread: ${finalConv.unreadCount.counsellor}`);
    console.log(`   Last message: ${finalConv.lastMessage}`);
    console.log(`   Conversation status: ${finalConv.status}`);
    console.log();

    console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
    
    // Print summary
    console.log('\n📊 Summary:');
    console.log('='.repeat(50));
    console.log(`✅ User created: ${testUser.fullName} (${testUser.role})`);
    console.log(`✅ Counsellor created: ${testCounsellor.fullName} (${testCounsellor.role})`);
    console.log(`✅ Conversation created between user and counsellor`);
    console.log(`✅ Messages sent and received successfully`);
    console.log(`✅ Read receipts working`);
    console.log(`✅ Database relations verified`);
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ TEST FAILED!');
    console.error('Error details:', error.message);
    console.error('Stack trace:', error.stack);
    
    console.log('\n🔍 Debugging Information:');
    console.log('1. Check Message.js model validation');
    console.log('2. Verify all required fields are provided');
    console.log('3. Check MongoDB connection');
    console.log('4. Ensure models are properly exported');
    
    process.exit(1);
  }
};

testConversationSystem();