import { useState, useEffect, useRef, useCallback } from 'react';

export function useSpeechRecognition(options = {}) {
  const { continuous = true, interimResults = true, lang = 'en-US' } = options;
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      setIsSupported(true);
      const recognition = new SR();
      recognition.continuous = continuous;
      recognition.interimResults = interimResults;
      recognition.lang = lang;

      recognition.onresult = (event) => {
        let final = '';
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const t = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            final += t + ' ';
          } else {
            interim += t;
          }
        }
        if (final) setTranscript(prev => prev + final);
        setInterimTranscript(interim);
      };

      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error || 'unknown');
        if (event.error !== 'no-speech') setIsListening(false);
      };

      recognition.onend = () => {
        if (recognitionRef.current && recognitionRef.current._shouldListen) {
          try { recognition.start(); } catch (e) { /* already started */ }
        } else {
          setIsListening(false);
        }
      };

      recognitionRef.current = recognition;
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current._shouldListen = false;
        try { recognitionRef.current.stop(); } catch (e) { /* ok */ }
      }
    };
  }, [continuous, interimResults, lang]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    recognitionRef.current._shouldListen = true;
    try { recognitionRef.current.start(); setIsListening(true); } catch (e) { /* already started */ }
  }, []);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    recognitionRef.current._shouldListen = false;
    try { recognitionRef.current.stop(); } catch (e) { /* ok */ }
    setIsListening(false);
    setInterimTranscript('');
  }, []);

  const resetTranscript = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
  }, []);

  return { isSupported, isListening, transcript, interimTranscript, startListening, stopListening, resetTranscript, setTranscript };
}
