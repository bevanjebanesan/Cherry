import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Container,
  Typography,
  TextField,
  Paper,
  Stack,
  Alert,
  CircularProgress,
} from '@mui/material';
import {
  VideoCall as VideoCallIcon,
  Login as LoginIcon,
  BugReport as BugReportIcon,
} from '@mui/icons-material';
import axios from 'axios';

const Home: React.FC = () => {
  const navigate = useNavigate();
  const [meetingId, setMeetingId] = useState('');
  const [error, setError] = useState('');
  const [backendUrl, setBackendUrl] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    const url = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';
    setBackendUrl(url);
  }, []);

  const createMeeting = async () => {
    try {
      setLoading(true);
      setError('');
      // Clear any stored user data from previous meetings
      sessionStorage.removeItem('userName');
      
      const backendUrl = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';
      console.log('Using backend URL:', backendUrl);
      
      const response = await axios.post(`${backendUrl}/api/meetings/create`);
      console.log('Meeting created successfully:', response.data);
      const { meetingId } = response.data;
      navigate(`/meeting/${meetingId}`);
    } catch (error: any) {
      console.error('Error creating meeting:', error);
      if (error.response) {
        console.error('Response data:', error.response.data);
        console.error('Response status:', error.response.status);
        setError(`Failed to create meeting (${error.response.status}). Please try again.`);
      } else if (error.request) {
        console.error('No response received:', error.request);
        setError('Failed to create meeting. The server is not responding. Please try again later.');
      } else {
        console.error('Error message:', error.message);
        setError(`Failed to create meeting: ${error.message}`);
      }
    } finally {
      setLoading(false);
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

  const testBackendConnection = async () => {
    setLoading(true);
    setError('');
    setTestResult(null);
    
    try {
      console.log('Testing connection to:', backendUrl);
      const response = await axios.get(`${backendUrl}/api/test`);
      console.log('Test response:', response.data);
      setTestResult(JSON.stringify(response.data, null, 2));
    } catch (error: any) {
      console.error('Error testing backend:', error);
      if (error.response) {
        setError(`Error ${error.response.status}: ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        setError('No response received from server. The backend might be down or unreachable.');
      } else {
        setError(`Error: ${error.message}`);
      }
    } finally {
      setLoading(false);
    }
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

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}>
            <CircularProgress />
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ my: 2 }}>
            {error}
          </Alert>
        )}

        {testResult && (
          <Alert severity="success" sx={{ my: 2 }}>
            <Typography variant="body1">Backend connection successful!</Typography>
            <Box component="pre" sx={{ mt: 1, textAlign: 'left', fontSize: '0.8rem' }}>
              {testResult}
            </Box>
          </Alert>
        )}

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
              disabled={loading}
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
              disabled={loading}
            >
              Join Meeting
            </Button>
          </Paper>
        </Stack>

        <Box sx={{ mt: 4 }}>
          <Button 
            variant="outlined" 
            color="secondary"
            onClick={() => setShowDebug(!showDebug)}
            startIcon={<BugReportIcon />}
          >
            {showDebug ? 'Hide Debug Tools' : 'Show Debug Tools'}
          </Button>

          {showDebug && (
            <Paper sx={{ p: 3, mt: 2 }}>
              <Typography variant="h6" gutterBottom>
                Debug Information
              </Typography>
              <Typography variant="body1" gutterBottom>
                Backend URL: <code>{backendUrl}</code>
              </Typography>
              <Button 
                variant="contained" 
                color="secondary"
                onClick={testBackendConnection}
                disabled={loading}
                sx={{ mt: 2 }}
              >
                Test Backend Connection
              </Button>
            </Paper>
          )}
        </Box>
      </Box>
    </Container>
  );
};

export default Home;
