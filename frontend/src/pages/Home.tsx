import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Container,
  Typography,
  TextField,
  Paper,
  Stack,
} from '@mui/material';
import {
  VideoCall as VideoCallIcon,
  Login as LoginIcon,
} from '@mui/icons-material';
import axios from 'axios';

const Home: React.FC = () => {
  const navigate = useNavigate();
  const [meetingId, setMeetingId] = useState('');
  const [error, setError] = useState('');

  const createMeeting = async () => {
    try {
      // Clear any stored user data from previous meetings
      sessionStorage.removeItem('userName');
      
      const backendUrl = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';
      const response = await axios.post(`${backendUrl}/api/meetings/create`);
      const { meetingId } = response.data;
      navigate(`/meeting/${meetingId}`);
    } catch (error) {
      console.error('Error creating meeting:', error);
      setError('Failed to create meeting. Please try again.');
    }
  };

  const joinMeeting = () => {
    if (!meetingId.trim()) {
      setError('Please enter a meeting ID');
      return;
    }
    
    // Clear any stored user data from previous meetings
    sessionStorage.removeItem('userName');
    
    navigate(`/meeting/${meetingId}`);
  };

  return (
    <Container maxWidth="md">
      <Box sx={{ my: 8, textAlign: 'center' }}>
        <Typography variant="h2" component="h1" gutterBottom>
          Cherry
        </Typography>
        <Typography variant="h5" color="text.secondary" paragraph>
          Simple and secure video conferencing for everyone
        </Typography>

        <Stack 
          direction={{ xs: 'column', md: 'row' }} 
          spacing={4} 
          sx={{ mt: 4 }}
          justifyContent="center"
        >
          <Paper 
            elevation={3} 
            sx={{ 
              p: 4, 
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 2
            }}
          >
            <VideoCallIcon sx={{ fontSize: 60, color: 'primary.main' }} />
            <Typography variant="h5" gutterBottom>
              New Meeting
            </Typography>
            <Typography variant="body1" color="text.secondary" paragraph sx={{ mb: 2 }}>
              Create a new meeting and invite others
            </Typography>
            <Button 
              variant="contained" 
              size="large" 
              onClick={createMeeting}
              startIcon={<VideoCallIcon />}
              fullWidth
            >
              Create Meeting
            </Button>
          </Paper>
          
          <Paper 
            elevation={3} 
            sx={{ 
              p: 4, 
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 2
            }}
          >
            <LoginIcon sx={{ fontSize: 60, color: 'primary.main' }} />
            <Typography variant="h5" gutterBottom>
              Join Meeting
            </Typography>
            <Typography variant="body1" color="text.secondary" paragraph>
              Enter a meeting ID to join an existing meeting
            </Typography>
            <TextField
              fullWidth
              label="Meeting ID"
              variant="outlined"
              value={meetingId}
              onChange={(e) => {
                setMeetingId(e.target.value);
                setError('');
              }}
              error={!!error}
              helperText={error}
              sx={{ mb: 2 }}
            />
            <Button 
              variant="contained" 
              size="large" 
              onClick={joinMeeting}
              startIcon={<LoginIcon />}
              fullWidth
            >
              Join Meeting
            </Button>
          </Paper>
        </Stack>
      </Box>
    </Container>
  );
};

export default Home;
