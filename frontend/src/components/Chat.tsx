import React, { useState, useEffect, useRef } from 'react';
import { 
  Box, 
  TextField, 
  Button,
  List, 
  ListItem, 
  Avatar, 
  Typography, 
  Paper,
  IconButton,
} from '@mui/material';
import { Send as SendIcon } from '@mui/icons-material';
import { Socket } from 'socket.io-client';

interface Message {
  sender: string;
  content: string;
  timestamp: Date;
  senderName?: string;
}

interface ChatProps {
  socket: Socket | null;
  meetingId: string;
  userName: string;
}

const Chat: React.FC<ChatProps> = ({ socket, meetingId, userName }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!socket) return;

    // Listen for chat messages
    const handleReceiveMessage = (message: Message) => {
      console.log('Received message:', message);
      setMessages(prevMessages => [...prevMessages, message]);
    };

    socket.on('receive-message', handleReceiveMessage);

    return () => {
      socket.off('receive-message', handleReceiveMessage);
    };
  }, [socket]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!socket || !newMessage.trim()) return;

    const message: Message = {
      sender: socket.id || 'unknown',
      content: newMessage,
      timestamp: new Date(),
      senderName: userName,
    };

    console.log('Sending message:', message);
    socket.emit('send-message', { meetingId, message });
    setNewMessage('');
  };

  // Get initials for avatar
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  };

  return (
    <Box className="chat-container">
      <List className="chat-messages">
        {messages.map((message, index) => {
          const isCurrentUser = message.sender === socket?.id;
          const displayName = isCurrentUser ? userName : (message.senderName || 'Guest');
          
          return (
            <ListItem
              key={index}
              sx={{
                flexDirection: 'column',
                alignItems: isCurrentUser ? 'flex-end' : 'flex-start',
                mb: 1,
              }}
            >
              <Box sx={{ 
                display: 'flex', 
                flexDirection: isCurrentUser ? 'row-reverse' : 'row',
                alignItems: 'flex-end',
                mb: 0.5,
                gap: 1
              }}>
                <Avatar 
                  sx={{ 
                    width: 32, 
                    height: 32,
                    bgcolor: isCurrentUser ? '#e91e63' : '#9c27b0',
                    fontSize: '0.875rem'
                  }}
                >
                  {getInitials(displayName)}
                </Avatar>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {displayName}
                  </Typography>
                  <Paper
                    elevation={0}
                    sx={{
                      backgroundColor: isCurrentUser ? '#e91e63' : '#f5f5f5',
                      color: isCurrentUser ? 'white' : 'text.primary',
                      borderRadius: 2,
                      p: 1.5,
                      maxWidth: '250px',
                      wordBreak: 'break-word',
                    }}
                  >
                    <Typography variant="body2">{message.content}</Typography>
                  </Paper>
                </Box>
              </Box>
              <Typography 
                variant="caption" 
                color="text.secondary" 
                sx={{ 
                  alignSelf: isCurrentUser ? 'flex-end' : 'flex-start',
                  ml: isCurrentUser ? 0 : 5,
                  mr: isCurrentUser ? 5 : 0,
                }}
              >
                {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Typography>
            </ListItem>
          );
        })}
        <div ref={messagesEndRef} />
      </List>
      <Box
        component="form"
        onSubmit={handleSendMessage}
        className="chat-input"
      >
        <TextField
          fullWidth
          size="small"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Type a message..."
          onKeyPress={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSendMessage(e);
            }
          }}
        />
        <IconButton type="submit" color="primary" sx={{ ml: 1 }}>
          <SendIcon />
        </IconButton>
      </Box>
    </Box>
  );
};

export default Chat;
