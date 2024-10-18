import React, { useState, useEffect, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import { PitchDetector } from 'pitchy';
import { Mic, MicOff, RefreshCw } from 'lucide-react';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const getNote = (frequency: number): string => {
  const noteNum = 12 * (Math.log2(frequency / 440) + 4);
  const noteIndex = Math.round(noteNum) % 12;
  const octave = Math.floor(noteNum / 12);
  return `${NOTES[noteIndex]}${octave}`;
};

const App: React.FC = () => {
  const [isListening, setIsListening] = useState(false);
  const [pitchData, setPitchData] = useState<number[]>([]);
  const [currentNote, setCurrentNote] = useState<string>('');
  const [maxRange, setMaxRange] = useState(1000);
  const [cancelNoise, setCancelNoise] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationTime, setCalibrationTime] = useState(5);
  const [smoothness, setSmoothness] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const noiseFloorRef = useRef<number>(0);
  const noiseProfileRef = useRef<Float32Array | null>(null);

  useEffect(() => {
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  const calibrateNoise = () => {
    setIsCalibrating(true);
    noiseProfileRef.current = new Float32Array(analyserRef.current!.frequencyBinCount);
    let calibrationFrames = 0;
    const maxCalibrationFrames = calibrationTime * 60; // 60 frames per second

    const updateCalibration = () => {
      const frequencyData = new Float32Array(analyserRef.current!.frequencyBinCount);
      analyserRef.current!.getFloatFrequencyData(frequencyData);

      if (calibrationFrames === 0) {
        noiseProfileRef.current!.set(frequencyData);
      } else {
        for (let i = 0; i < frequencyData.length; i++) {
          noiseProfileRef.current![i] = Math.max(noiseProfileRef.current![i], frequencyData[i]);
        }
      }

      calibrationFrames++;

      if (calibrationFrames < maxCalibrationFrames) {
        requestAnimationFrame(updateCalibration);
      } else {
        setIsCalibrating(false);
        noiseFloorRef.current = Math.max(...noiseProfileRef.current!);
      }
    };

    updateCalibration();
  };

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
      sourceRef.current.connect(analyserRef.current);

      const detector = PitchDetector.forFloat32Array(analyserRef.current.fftSize);
      const input = new Float32Array(detector.inputLength);

      if (cancelNoise) {
        calibrateNoise();
      }

      const updatePitch = () => {
        analyserRef.current!.getFloatTimeDomainData(input);
        
        if (cancelNoise && noiseProfileRef.current) {
          for (let i = 0; i < input.length; i++) {
            input[i] = Math.max(0, input[i] - noiseProfileRef.current[i % noiseProfileRef.current.length]);
          }
        }

        const [pitch] = detector.findPitch(input, audioContextRef.current!.sampleRate);
        
        if (pitch !== null && !Number.isNaN(pitch) && (!cancelNoise || pitch > noiseFloorRef.current)) {
          setPitchData(prevData => {
            const newData = [...prevData, pitch];
            if (smoothness > 0) {
              const smoothedData = [];
              for (let i = 0; i < newData.length; i++) {
                const start = Math.max(0, i - smoothness);
                const end = Math.min(newData.length, i + smoothness + 1);
                const slice = newData.slice(start, end);
                const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
                smoothedData.push(avg);
              }
              return smoothedData.slice(-100);
            }
            return newData.slice(-100); // Keep only the last 100 data points
          });
          setCurrentNote(getNote(pitch));
        }

        rafIdRef.current = requestAnimationFrame(updatePitch);
      };

      updatePitch();
      setIsListening(true);
    } catch (error) {
      console.error('Error accessing microphone:', error);
    }
  };

  const stopListening = () => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    setIsListening(false);
    setPitchData([]);
    setCurrentNote('');
  };

  const handleCancelNoiseChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCancelNoise(e.target.checked);
    if (e.target.checked && isListening) {
      calibrateNoise();
    }
  };

  const handleCalibrate = () => {
    if (isListening) {
      calibrateNoise();
    }
  };

  const chartData = {
    labels: pitchData.map((_, index) => index.toString()),
    datasets: [
      {
        label: 'Pitch (Hz)',
        data: pitchData,
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.1,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        beginAtZero: true,
        max: maxRange,
      },
    },
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
      <h1 className="text-3xl font-bold mb-4">Pitch Meter App</h1>
      <div className="w-full max-w-4xl bg-white rounded-lg shadow-md p-6 flex flex-col h-[80vh]">
        <div className="mb-4 flex justify-between items-center flex-wrap">
          <button
            onClick={isListening ? stopListening : startListening}
            className={`flex items-center justify-center px-4 py-2 rounded-full text-white ${
              isListening ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'
            }`}
            disabled={isCalibrating}
          >
            {isListening ? <MicOff className="mr-2" /> : <Mic className="mr-2" />}
            {isListening ? 'Stop Listening' : 'Start Listening'}
          </button>
          <div className="flex items-center">
            <span className="mr-2">Max Range:</span>
            <input
              type="range"
              min="200"
              max="1200"
              step="100"
              value={maxRange}
              onChange={(e) => setMaxRange(Number(e.target.value))}
              className="w-48"
            />
            <span className="ml-2">{maxRange} Hz</span>
          </div>
          <div className="flex items-center mt-2 sm:mt-0">
            <input
              type="checkbox"
              id="cancelNoise"
              checked={cancelNoise}
              onChange={handleCancelNoiseChange}
              className="mr-2"
            />
            <label htmlFor="cancelNoise" className="mr-4">Cancel Noise</label>
            <button
              onClick={handleCalibrate}
              className={`flex items-center justify-center px-4 py-2 rounded-full text-white bg-green-500 hover:bg-green-600 ${
                !isListening || isCalibrating ? 'opacity-50 cursor-not-allowed' : ''
              }`}
              disabled={!isListening || isCalibrating}
            >
              <RefreshCw className="mr-2" />
              Calibrate
            </button>
            {isCalibrating && <span className="ml-2 text-sm text-gray-500">Calibrating... {calibrationTime}s</span>}
          </div>
        </div>
        <div className="mb-4 flex items-center">
          <span className="mr-2">Smoothness:</span>
          <input
            type="range"
            min="0"
            max="10"
            value={smoothness}
            onChange={(e) => setSmoothness(Number(e.target.value))}
            className="w-48"
          />
          <span className="ml-2">{smoothness}</span>
        </div>
        <div className="text-center mb-4">
          <span className="text-2xl font-bold">{currentNote}</span>
          <span className="ml-4 text-xl">
            {pitchData.length > 0 ? `${pitchData[pitchData.length - 1].toFixed(2)} Hz` : ''}
          </span>
        </div>
        <div className="flex-grow">
          <Line data={chartData} options={chartOptions} />
        </div>
      </div>
    </div>
  );
};

export default App;