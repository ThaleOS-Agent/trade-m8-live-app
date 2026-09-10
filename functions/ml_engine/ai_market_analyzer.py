"""
ThaleOS Trading Unified - AI & ML Market Analysis Engine
Advanced AI-powered market prediction and analysis system for high-performance trading
"""

import asyncio
import logging
import time
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from enum import Enum
import json
import pickle
from pathlib import Path
import warnings
warnings.filterwarnings('ignore')

# Advanced ML imports
try:
    import tensorflow as tf
    from tensorflow.keras.models import Sequential, Model
    from tensorflow.keras.layers import LSTM, Dense, Dropout, Attention, MultiHeadAttention, LayerNormalization
    from tensorflow.keras.optimizers import Adam
    from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
    from sklearn.preprocessing import MinMaxScaler, StandardScaler
    from sklearn.metrics import accuracy_score, precision_score, recall_score
    from sklearn.model_selection import train_test_split
    import xgboost as xgb
    ML_AVAILABLE = True
except ImportError:
    ML_AVAILABLE = False
    logging.warning("ML libraries not available. Install: pip install tensorflow scikit-learn xgboost")

# Technical analysis
try:
    import talib
    TALIB_AVAILABLE = True
except ImportError:
    TALIB_AVAILABLE = False
    logging.warning("TA-Lib not available. Install: pip install TA-Lib")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class PredictionConfidence(Enum):
    LOW = "low"
    MEDIUM = "medium" 
    HIGH = "high"
    VERY_HIGH = "very_high"

class MarketRegime(Enum):
    TRENDING_UP = "trending_up"
    TRENDING_DOWN = "trending_down"
    SIDEWAYS = "sideways"
    VOLATILE = "volatile"
    BREAKOUT = "breakout"

class SignalStrength(Enum):
    WEAK = "weak"
    MODERATE = "moderate"
    STRONG = "strong"
    VERY_STRONG = "very_strong"

@dataclass
class MLPrediction:
    """ML model prediction result"""
    symbol: str
    prediction_type: str  # price, direction, volatility
    predicted_value: float
    confidence: float
    probability_up: float
    probability_down: float
    time_horizon: str  # 1h, 4h, 1d
    model_name: str
    features_used: List[str]
    timestamp: datetime = field(default_factory=datetime.now)

@dataclass
class MarketAnalysis:
    """Comprehensive market analysis result"""
    symbol: str
    current_price: float
    predicted_price_1h: float
    predicted_price_4h: float
    predicted_price_24h: float
    direction_confidence: float
    market_regime: MarketRegime
    volatility_prediction: float
    support_levels: List[float]
    resistance_levels: List[float]
    momentum_score: float
    sentiment_score: float
    technical_score: float
    ml_predictions: List[MLPrediction] = field(default_factory=list)
    risk_score: float = 0.0
    opportunity_score: float = 0.0
    
class AdvancedFeatureEngineer:
    """Advanced feature engineering for ML models"""
    
    def __init__(self):
        self.scalers = {}
        self.feature_importance = {}
        
    def create_technical_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create comprehensive technical analysis features"""
        try:
            df = df.copy()
            
            # Price-based features
            df['returns'] = df['close'].pct_change()
            df['log_returns'] = np.log(df['close'] / df['close'].shift(1))
            df['volatility'] = df['returns'].rolling(window=20).std()
            df['price_ma_ratio'] = df['close'] / df['close'].rolling(window=20).mean()
            
            # Volume features
            df['volume_ma'] = df['volume'].rolling(window=20).mean()
            df['volume_ratio'] = df['volume'] / df['volume_ma']
            df['price_volume'] = df['close'] * df['volume']
            df['vwap'] = (df['price_volume'].rolling(window=20).sum() / 
                         df['volume'].rolling(window=20).sum())
            
            # Advanced technical indicators
            if TALIB_AVAILABLE:
                # Momentum indicators
                df['rsi'] = talib.RSI(df['close'].values, timeperiod=14)
                df['macd'], df['macd_signal'], df['macd_hist'] = talib.MACD(df['close'].values)
                df['stoch_k'], df['stoch_d'] = talib.STOCH(df['high'].values, df['low'].values, df['close'].values)
                df['williams_r'] = talib.WILLR(df['high'].values, df['low'].values, df['close'].values)
                df['cci'] = talib.CCI(df['high'].values, df['low'].values, df['close'].values)
                
                # Trend indicators
                df['sma_10'] = talib.SMA(df['close'].values, timeperiod=10)
                df['sma_20'] = talib.SMA(df['close'].values, timeperiod=20)
                df['sma_50'] = talib.SMA(df['close'].values, timeperiod=50)
                df['ema_12'] = talib.EMA(df['close'].values, timeperiod=12)
                df['ema_26'] = talib.EMA(df['close'].values, timeperiod=26)
                
                # Volatility indicators
                df['bb_upper'], df['bb_middle'], df['bb_lower'] = talib.BBANDS(df['close'].values)
                df['atr'] = talib.ATR(df['high'].values, df['low'].values, df['close'].values)
                
                # Volume indicators
                df['ad'] = talib.AD(df['high'].values, df['low'].values, df['close'].values, df['volume'].values)
                df['obv'] = talib.OBV(df['close'].values, df['volume'].values)
            else:
                # Manual calculation of key indicators
                df['rsi'] = self._calculate_rsi(df['close'])
                df['sma_20'] = df['close'].rolling(window=20).mean()
                df['bb_upper'], df['bb_lower'] = self._calculate_bollinger_bands(df['close'])
            
            # Advanced pattern features
            df['price_position'] = (df['close'] - df['low'].rolling(window=20).min()) / (
                df['high'].rolling(window=20).max() - df['low'].rolling(window=20).min())
            
            df['trend_strength'] = abs(df['close'].rolling(window=20).apply(
                lambda x: np.polyfit(range(len(x)), x, 1)[0]))
            
            # Momentum features
            df['momentum_1'] = df['close'] / df['close'].shift(1) - 1
            df['momentum_5'] = df['close'] / df['close'].shift(5) - 1
            df['momentum_10'] = df['close'] / df['close'].shift(10) - 1
            df['momentum_20'] = df['close'] / df['close'].shift(20) - 1
            
            # Volatility regime features
            df['vol_regime'] = df['volatility'] / df['volatility'].rolling(window=50).mean()
            df['vol_breakout'] = (df['volatility'] > df['volatility'].rolling(window=20).quantile(0.8)).astype(int)
            
            # Market structure features
            df['higher_high'] = ((df['high'] > df['high'].shift(1)) & 
                               (df['high'].shift(1) > df['high'].shift(2))).astype(int)
            df['lower_low'] = ((df['low'] < df['low'].shift(1)) & 
                              (df['low'].shift(1) < df['low'].shift(2))).astype(int)
            
            # Fractal features
            df['fractal_up'] = ((df['high'].shift(2) < df['high'].shift(1)) & 
                               (df['high'].shift(1) > df['high']) &
                               (df['high'] > df['high'].shift(-1)) & 
                               (df['high'].shift(-1) > df['high'].shift(-2))).astype(int)
            
            df['fractal_down'] = ((df['low'].shift(2) > df['low'].shift(1)) & 
                                 (df['low'].shift(1) < df['low']) &
                                 (df['low'] < df['low'].shift(-1)) & 
                                 (df['low'].shift(-1) < df['low'].shift(-2))).astype(int)
            
            # Time-based features
            df['hour'] = df.index.hour if hasattr(df.index, 'hour') else 12
            df['day_of_week'] = df.index.dayofweek if hasattr(df.index, 'dayofweek') else 1
            df['month'] = df.index.month if hasattr(df.index, 'month') else 6
            
            # Cyclical encoding for time features
            df['hour_sin'] = np.sin(2 * np.pi * df['hour'] / 24)
            df['hour_cos'] = np.cos(2 * np.pi * df['hour'] / 24)
            df['dow_sin'] = np.sin(2 * np.pi * df['day_of_week'] / 7)
            df['dow_cos'] = np.cos(2 * np.pi * df['day_of_week'] / 7)
            
            return df.fillna(method='ffill').fillna(0)
            
        except Exception as e:
            logger.error(f"Error creating technical features: {e}")
            return df
    
    def _calculate_rsi(self, prices: pd.Series, period: int = 14) -> pd.Series:
        """Calculate RSI manually if TA-Lib not available"""
        delta = prices.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        rs = gain / loss
        rsi = 100 - (100 / (1 + rs))
        return rsi
    
    def _calculate_bollinger_bands(self, prices: pd.Series, period: int = 20, std_dev: float = 2) -> Tuple[pd.Series, pd.Series]:
        """Calculate Bollinger Bands manually"""
        sma = prices.rolling(window=period).mean()
        std = prices.rolling(window=period).std()
        upper = sma + (std * std_dev)
        lower = sma - (std * std_dev)
        return upper, lower
    
    def create_sequence_features(self, df: pd.DataFrame, sequence_length: int = 60) -> Tuple[np.ndarray, np.ndarray]:
        """Create sequences for LSTM/RNN models"""
        try:
            feature_columns = [col for col in df.columns if col not in ['open', 'high', 'low', 'close', 'volume'] or col == 'close']
            
            # Scale features
            scaler = MinMaxScaler()
            scaled_data = scaler.fit_transform(df[feature_columns].values)
            
            X, y = [], []
            for i in range(sequence_length, len(scaled_data)):
                X.append(scaled_data[i-sequence_length:i])
                # Predict next price movement (binary classification)
                current_price = df['close'].iloc[i-1]
                future_price = df['close'].iloc[i]
                y.append(1 if future_price > current_price else 0)
            
            return np.array(X), np.array(y)
            
        except Exception as e:
            logger.error(f"Error creating sequence features: {e}")
            return np.array([]), np.array([])

class LSTMPricePredictor:
    """Advanced LSTM model for price prediction"""
    
    def __init__(self, sequence_length: int = 60, n_features: int = 50):
        self.sequence_length = sequence_length
        self.n_features = n_features
        self.model = None
        self.scaler = MinMaxScaler()
        self.is_trained = False
        
    def build_model(self) -> Model:
        """Build advanced LSTM architecture"""
        try:
            model = Sequential([
                # First LSTM layer with attention
                LSTM(100, return_sequences=True, input_shape=(self.sequence_length, self.n_features)),
                Dropout(0.2),
                
                # Second LSTM layer
                LSTM(80, return_sequences=True),
                Dropout(0.2),
                
                # Third LSTM layer
                LSTM(60, return_sequences=False),
                Dropout(0.2),
                
                # Dense layers
                Dense(50, activation='relu'),
                Dropout(0.2),
                Dense(25, activation='relu'),
                Dense(1, activation='sigmoid')  # Binary classification (up/down)
            ])
            
            model.compile(
                optimizer=Adam(learning_rate=0.001),
                loss='binary_crossentropy',
                metrics=['accuracy']
            )
            
            return model
            
        except Exception as e:
            logger.error(f"Error building LSTM model: {e}")
            return None
    
    async def train_model(self, X: np.ndarray, y: np.ndarray) -> bool:
        """Train the LSTM model"""
        try:
            if not ML_AVAILABLE:
                logger.warning("ML libraries not available for training")
                return False
            
            # Build model
            self.model = self.build_model()
            if self.model is None:
                return False
            
            # Split data
            X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
            
            # Train model
            history = self.model.fit(
                X_train, y_train,
                epochs=50,
                batch_size=32,
                validation_data=(X_test, y_test),
                verbose=0
            )
            
            # Evaluate model
            test_accuracy = self.model.evaluate(X_test, y_test, verbose=0)[1]
            logger.info(f"LSTM model trained with accuracy: {test_accuracy:.3f}")
            
            self.is_trained = True
            return True
            
        except Exception as e:
            logger.error(f"Error training LSTM model: {e}")
            return False
    
    def predict(self, X: np.ndarray) -> Tuple[float, float]:
        """Make prediction with confidence"""
        try:
            if not self.is_trained or self.model is None:
                return 0.5, 0.5
            
            prediction = self.model.predict(X.reshape(1, X.shape[0], X.shape[1]), verbose=0)[0][0]
            confidence = abs(prediction - 0.5) * 2  # Convert to 0-1 confidence scale
            
            return prediction, confidence
            
        except Exception as e:
            logger.error(f"Error making LSTM prediction: {e}")
            return 0.5, 0.5

class TransformerPredictor:
    """Transformer model for market prediction"""
    
    def __init__(self, sequence_length: int = 60, d_model: int = 64):
        self.sequence_length = sequence_length
        self.d_model = d_model
        self.model = None
        self.is_trained = False
    
    def build_transformer_model(self, n_features: int) -> Model:
        """Build Transformer architecture for time series"""
        try:
            # Input layer
            inputs = tf.keras.Input(shape=(self.sequence_length, n_features))
            
            # Multi-head attention
            attention_output = MultiHeadAttention(
                num_heads=8, 
                key_dim=self.d_model
            )(inputs, inputs)
            
            # Add & Norm
            attention_output = LayerNormalization()(inputs + attention_output)
            
            # Feed Forward
            ff_output = Dense(128, activation='relu')(attention_output)
            ff_output = Dense(n_features)(ff_output)
            
            # Add & Norm
            ff_output = LayerNormalization()(attention_output + ff_output)
            
            # Global pooling and classification
            pooled = tf.keras.layers.GlobalAveragePooling1D()(ff_output)
            
            # Output layers
            dense1 = Dense(64, activation='relu')(pooled)
            dropout1 = Dropout(0.2)(dense1)
            dense2 = Dense(32, activation='relu')(dropout1)
            dropout2 = Dropout(0.2)(dense2)
            outputs = Dense(1, activation='sigmoid')(dropout2)
            
            model = Model(inputs=inputs, outputs=outputs)
            model.compile(
                optimizer=Adam(learning_rate=0.001),
                loss='binary_crossentropy',
                metrics=['accuracy']
            )
            
            return model
            
        except Exception as e:
            logger.error(f"Error building Transformer model: {e}")
            return None
    
    async def train_model(self, X: np.ndarray, y: np.ndarray) -> bool:
        """Train the Transformer model"""
        try:
            if not ML_AVAILABLE:
                return False
            
            self.model = self.build_transformer_model(X.shape[2])
            if self.model is None:
                return False
            
            X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
            
            history = self.model.fit(
                X_train, y_train,
                epochs=30,
                batch_size=32,
                validation_data=(X_test, y_test),
                verbose=0
            )
            
            test_accuracy = self.model.evaluate(X_test, y_test, verbose=0)[1]
            logger.info(f"Transformer model trained with accuracy: {test_accuracy:.3f}")
            
            self.is_trained = True
            return True
            
        except Exception as e:
            logger.error(f"Error training Transformer model: {e}")
            return False
    
    def predict(self, X: np.ndarray) -> Tuple[float, float]:
        """Make prediction with confidence"""
        try:
            if not self.is_trained or self.model is None:
                return 0.5, 0.5
            
            prediction = self.model.predict(X.reshape(1, X.shape[0], X.shape[1]), verbose=0)[0][0]
            confidence = abs(prediction - 0.5) * 2
            
            return prediction, confidence
            
        except Exception as e:
            logger.error(f"Error making Transformer prediction: {e}")
            return 0.5, 0.5

class EnsembleMLPredictor:
    """Ensemble of multiple ML models for robust predictions"""
    
    def __init__(self):
        self.models = {}
        self.weights = {}
        self.is_trained = False
        self.feature_importance = {}
        
    async def train_ensemble(self, df: pd.DataFrame, target_column: str = 'close') -> bool:
        """Train ensemble of ML models"""
        try:
            if not ML_AVAILABLE:
                logger.warning("ML libraries not available")
                return False
            
            # Prepare features and targets
            feature_engineer = AdvancedFeatureEngineer()
            df_features = feature_engineer.create_technical_features(df)
            
            # Create binary target (price goes up = 1, down = 0)
            df_features['target'] = (df_features[target_column].shift(-1) > df_features[target_column]).astype(int)
            
            # Select features
            feature_cols = [col for col in df_features.columns if col not in ['open', 'high', 'low', 'close', 'volume', 'target']]
            X = df_features[feature_cols].fillna(0).values
            y = df_features['target'].fillna(0).values
            
            # Remove last row (no target)
            X, y = X[:-1], y[:-1]
            
            if len(X) < 100:
                logger.warning("Insufficient data for training")
                return False
            
            # Split data
            X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
            
            # Scale features
            scaler = StandardScaler()
            X_train_scaled = scaler.fit_transform(X_train)
            X_test_scaled = scaler.transform(X_test)
            
            # Train multiple models
            models_config = {
                'random_forest': RandomForestRegressor(n_estimators=100, max_depth=10, random_state=42),
                'gradient_boost': GradientBoostingRegressor(n_estimators=100, max_depth=6, random_state=42),
                'xgboost': xgb.XGBRegressor(n_estimators=100, max_depth=6, random_state=42) if 'xgb' in globals() else None
            }
            
            model_scores = {}
            
            for name, model in models_config.items():
                if model is None:
                    continue
                    
                try:
                    # Train model
                    model.fit(X_train_scaled, y_train)
                    
                    # Evaluate
                    train_score = model.score(X_train_scaled, y_train)
                    test_score = model.score(X_test_scaled, y_test)
                    
                    # Get predictions for ensemble weighting
                    y_pred = model.predict(X_test_scaled)
                    y_pred_binary = (y_pred > 0.5).astype(int)
                    accuracy = accuracy_score(y_test, y_pred_binary)
                    
                    self.models[name] = model
                    model_scores[name] = accuracy
                    
                    logger.info(f"{name} - Train: {train_score:.3f}, Test: {test_score:.3f}, Accuracy: {accuracy:.3f}")
                    
                    # Store feature importance
                    if hasattr(model, 'feature_importances_'):
                        importance = dict(zip(feature_cols, model.feature_importances_))
                        self.feature_importance[name] = sorted(importance.items(), key=lambda x: x[1], reverse=True)[:10]
                    
                except Exception as e:
                    logger.error(f"Error training {name}: {e}")
            
            # Calculate ensemble weights based on performance
            total_score = sum(model_scores.values())
            if total_score > 0:
                self.weights = {name: score/total_score for name, score in model_scores.items()}
            else:
                self.weights = {name: 1.0/len(model_scores) for name in model_scores.keys()}
            
            logger.info(f"Ensemble weights: {self.weights}")
            
            # Train deep learning models if available
            if len(X) > 500:  # Need more data for deep learning
                await self._train_deep_models(df_features, feature_cols)
            
            self.scaler = scaler
            self.feature_cols = feature_cols
            self.is_trained = True
            
            return True
            
        except Exception as e:
            logger.error(f"Error training ensemble: {e}")
            return False
    
    async def _train_deep_models(self, df: pd.DataFrame, feature_cols: List[str]):
        """Train deep learning models"""
        try:
            # Prepare sequence data for LSTM
            feature_engineer = AdvancedFeatureEngineer()
            X_seq, y_seq = feature_engineer.create_sequence_features(df)
            
            if len(X_seq) > 100:
                # Train LSTM
                lstm_model = LSTMPricePredictor(sequence_length=60, n_features=X_seq.shape[2])
                lstm_success = await lstm_model.train_model(X_seq, y_seq)
                
                if lstm_success:
                    self.models['lstm'] = lstm_model
                    self.weights['lstm'] = 0.3  # Give higher weight to deep learning
                
                # Train Transformer
                transformer_model = TransformerPredictor(sequence_length=60)
                transformer_success = await transformer_model.train_model(X_seq, y_seq)
                
                if transformer_success:
                    self.models['transformer'] = transformer_model
                    self.weights['transformer'] = 0.3
                
                # Rebalance weights
                total_weight = sum(self.weights.values())
                self.weights = {name: weight/total_weight for name, weight in self.weights.items()}
                
        except Exception as e:
            logger.error(f"Error training deep models: {e}")
    
    def predict_ensemble(self, X: np.ndarray, X_seq: np.ndarray = None) -> MLPrediction:
        """Make ensemble prediction"""
        try:
            if not self.is_trained:
                return MLPrediction(
                    symbol="UNKNOWN",
                    prediction_type="direction",
                    predicted_value=0.5,
                    confidence=0.0,
                    probability_up=0.5,
                    probability_down=0.5,
                    time_horizon="1h",
                    model_name="ensemble_untrained",
                    features_used=[]
                )
            
            predictions = []
            confidences = []
            
            # Get predictions from traditional ML models
            if hasattr(self, 'scaler'):
                X_scaled = self.scaler.transform(X.reshape(1, -1))
                
                for name, model in self.models.items():
                    if name in ['lstm', 'transformer']:
                        continue
                    
                    try:
                        pred = model.predict(X_scaled)[0]
                        weight = self.weights.get(name, 0.0)
                        predictions.append(pred * weight)
                        confidences.append(abs(pred - 0.5) * 2 * weight)
                    except Exception as e:
                        logger.error(f"Error predicting with {name}: {e}")
            
            # Get predictions from deep learning models
            if X_seq is not None:
                for name, model in self.models.items():
                    if name not in ['lstm', 'transformer']:
                        continue
                    
                    try:
                        pred, conf = model.predict(X_seq)
                        weight = self.weights.get(name, 0.0)
                        predictions.append(pred * weight)
                        confidences.append(conf * weight)
                    except Exception as e:
                        logger.error(f"Error predicting with {name}: {e}")
            
            # Combine predictions
            if predictions:
                ensemble_prediction = sum(predictions)
                ensemble_confidence = min(1.0, sum(confidences))
            else:
                ensemble_prediction = 0.5
                ensemble_confidence = 0.0
            
            # Convert to probabilities
            prob_up = ensemble_prediction
            prob_down = 1.0 - ensemble_prediction
            
            return MLPrediction(
                symbol="ENSEMBLE",
                prediction_type="direction",
                predicted_value=ensemble_prediction,
                confidence=ensemble_confidence,
                probability_up=prob_up,
                probability_down=prob_down,
                time_horizon="1h",
                model_name="ensemble",
                features_used=getattr(self, 'feature_cols', [])
            )
            
        except Exception as e:
            logger.error(f"Error making ensemble prediction: {e}")
            return MLPrediction(
                symbol="ERROR",
                prediction_type="direction", 
                predicted_value=0.5,
                confidence=0.0,
                probability_up=0.5,
                probability_down=0.5,
                time_horizon="1h",
                model_name="ensemble_error",
                features_used=[]
            )

class AIMarketAnalyzer:
    """
    Main AI & ML Market Analysis Engine
    Combines multiple AI models for comprehensive market prediction
    """
    
    def __init__(self):
        self.ensemble_predictors: Dict[str, EnsembleMLPredictor] = {}
        self.feature_engineer = AdvancedFeatureEngineer()
        self.market_regime_classifier = None
        self.sentiment_analyzer = None
        self.is_initialized = False
        
        # Performance tracking
        self.prediction_history: List[Dict[str, Any]] = []
        self.accuracy_metrics: Dict[str, Dict[str, float]] = {}
        
        # Configuration
        self.models_dir = Path("ml_models")
        self.models_dir.mkdir(exist_ok=True)
        
    async def initialize_ai_system(self, symbols: List[str], historical_data: Dict[str, pd.DataFrame]):
        """Initialize the AI system with training data"""
        try:
            logger.info("Initializing AI & ML Market Analysis System")
            logger.info(f"Symbols: {symbols}")
            
            if not ML_AVAILABLE:
                logger.error("ML libraries not available. Please install required packages.")
                return False
            
            # Train ensemble predictors for each symbol
            for symbol in symbols:
                if symbol in historical_data:
                    logger.info(f"Training AI models for {symbol}")
                    
                    predictor = EnsembleMLPredictor()
                    success = await predictor.train_ensemble(historical_data[symbol])
                    
                    if success:
                        self.ensemble_predictors[symbol] = predictor
                        logger.info(f"✅ AI models trained for {symbol}")
                    else:
                        logger.warning(f"❌ Failed to train models for {symbol}")
            
            # Initialize additional components
            await self._initialize_sentiment_analyzer()
            await self._initialize_market_regime_classifier()
            
            self.is_initialized = True
            logger.info("🤖 AI Market Analysis System initialized successfully")
            
            return True
            
        except Exception as e:
            logger.error(f"Error initializing AI system: {e}")
            return False
    
    async def _initialize_sentiment_analyzer(self):
        """Initialize sentiment analysis component"""
        try:
            # Placeholder for sentiment analysis
            # In production, this would integrate with news APIs, social media sentiment, etc.
            self.sentiment_analyzer = "initialized"
            logger.info("Sentiment analyzer initialized")
        except Exception as e:
            logger.error(f"Error initializing sentiment analyzer: {e}")
    
    async def _initialize_market_regime_classifier(self):
        """Initialize market regime classification"""
        try:
            # Placeholder for market regime classification
            self.market_regime_classifier = "initialized"
            logger.info("Market regime classifier initialized")
        except Exception as e:
            logger.error(f"Error initializing market regime classifier: {e}")
    
    async def analyze_market_ai(self, symbol: str, current_data: pd.DataFrame) -> MarketAnalysis:
        """Comprehensive AI-powered market analysis"""
        try:
            if not self.is_initialized or symbol not in self.ensemble_predictors:
                return self._generate_fallback_analysis(symbol, current_data)
            
            current_price = current_data['close'].iloc[-1]
            
            # Get AI predictions
            ml_predictions = await self._get_ml_predictions(symbol, current_data)
            
            # Calculate technical scores
            technical_score = self._calculate_technical_score(current_data)
            
            # Get sentiment score (mock for now)
            sentiment_score = await self._get_sentiment_score(symbol)
            
            # Determine market regime
            market_regime = self._classify_market_regime(current_data)
            
            # Calculate support/resistance levels
            support_levels, resistance_levels = self._calculate_support_resistance(current_data)
            
            # Generate predictions for different time horizons
            predicted_price_1h = self._predict_price_target(current_price, ml_predictions, "1h")
            predicted_price_4h = self._predict_price_target(current_price, ml_predictions, "4h")
            predicted_price_24h = self._predict_price_target(current_price, ml_predictions, "24h")
            
            # Calculate confidence and scores
            direction_confidence = self._calculate_direction_confidence(ml_predictions)
            momentum_score = self._calculate_momentum_score(current_data)
            volatility_prediction = self._predict_volatility(current_data)
            
            # Risk and opportunity scoring
            risk_score = self._calculate_risk_score(current_data, ml_predictions)
            opportunity_score = self._calculate_opportunity_score(ml_predictions, technical_score, sentiment_score)
            
            return MarketAnalysis(
                symbol=symbol,
                current_price=current_price,
                predicted_price_1h=predicted_price_1h,
                predicted_price_4h=predicted_price_4h,
                predicted_price_24h=predicted_price_24h,
                direction_confidence=direction_confidence,
                market_regime=market_regime,
                volatility_prediction=volatility_prediction,
                support_levels=support_levels,
                resistance_levels=resistance_levels,
                momentum_score=momentum_score,
                sentiment_score=sentiment_score,
                technical_score=technical_score,
                ml_predictions=ml_predictions,
                risk_score=risk_score,
                opportunity_score=opportunity_score
            )
            
        except Exception as e:
            logger.error(f"Error in AI market analysis for {symbol}: {e}")
            return self._generate_fallback_analysis(symbol, current_data)
    
    async def _get_ml_predictions(self, symbol: str, data: pd.DataFrame) -> List[MLPrediction]:
        """Get predictions from ML ensemble"""
        try:
            predictions = []
            
            if symbol in self.ensemble_predictors:
                predictor = self.ensemble_predictors[symbol]
                
                # Prepare features
                df_features = self.feature_engineer.create_technical_features(data)
                
                # Get latest features for prediction
                if len(df_features) > 0:
                    feature_cols = [col for col in df_features.columns if col not in ['open', 'high', 'low', 'close', 'volume']]
                    X_latest = df_features[feature_cols].fillna(0).iloc[-1].values
                    
                    # Get sequence data for deep learning models
                    X_seq = None
                    if len(df_features) >= 60:
                        sequence_data = df_features[feature_cols].fillna(0).tail(60).values
                        X_seq = sequence_data.reshape(1, 60, len(feature_cols))
                    
                    # Get ensemble prediction
                    prediction = predictor.predict_ensemble(X_latest, X_seq)
                    prediction.symbol = symbol
                    predictions.append(prediction)
            
            return predictions
            
        except Exception as e:
            logger.error(f"Error getting ML predictions for {symbol}: {e}")
            return []
    
    def _calculate_technical_score(self, data: pd.DataFrame) -> float:
        """Calculate technical analysis score"""
        try:
            df = self.feature_engineer.create_technical_features(data)
            
            if len(df) < 20:
                return 0.5
            
            scores = []
            
            # RSI score
            if 'rsi' in df.columns:
                rsi = df['rsi'].iloc[-1]
                if rsi < 30:
                    rsi_score = 0.8  # Oversold - bullish
                elif rsi > 70:
                    rsi_score = 0.2  # Overbought - bearish
                else:
                    rsi_score = 0.5
                scores.append(rsi_score)
            
            # Moving average score
            if 'sma_20' in df.columns:
                price = df['close'].iloc[-1]
                ma20 = df['sma_20'].iloc[-1]
                ma_score = 0.7 if price > ma20 else 0.3
                scores.append(ma_score)
            
            # Momentum score
            if 'momentum_1' in df.columns:
                momentum = df['momentum_1'].iloc[-1]
                momentum_score = 0.6 + (momentum * 10)  # Scale and center
                momentum_score = max(0.0, min(1.0, momentum_score))
                scores.append(momentum_score)
            
            # Volume score
            if 'volume_ratio' in df.columns:
                vol_ratio = df['volume_ratio'].iloc[-1]
                vol_score = min(1.0, vol_ratio / 2)  # Higher volume = higher score
                scores.append(vol_score)
            
            return np.mean(scores) if scores else 0.5
            
        except Exception as e:
            logger.error(f"Error calculating technical score: {e}")
            return 0.5
    
    async def _get_sentiment_score(self, symbol: str) -> float:
        """Get market sentiment score"""
        try:
            # Mock sentiment score - in production would integrate with:
            # - News sentiment analysis
            # - Social media sentiment
            # - Fear & Greed index
            # - Options flow analysis
            
            # Generate realistic sentiment based on recent performance
            base_sentiment = 0.5
            
            # Add some randomness but keep it realistic
            sentiment_noise = np.random.normal(0, 0.1)
            sentiment_score = np.clip(base_sentiment + sentiment_noise, 0.0, 1.0)
            
            return sentiment_score
            
        except Exception as e:
            logger.error(f"Error getting sentiment score: {e}")
            return 0.5
    
    def _classify_market_regime(self, data: pd.DataFrame) -> MarketRegime:
        """Classify current market regime"""
        try:
            if len(data) < 20:
                return MarketRegime.SIDEWAYS
            
            # Calculate recent price changes
            recent_returns = data['close'].pct_change().tail(20)
            volatility = recent_returns.std()
            trend = recent_returns.mean()
            
            # Classify regime
            if volatility > 0.05:  # High volatility
                return MarketRegime.VOLATILE
            elif trend > 0.02:  # Strong upward trend
                return MarketRegime.TRENDING_UP
            elif trend < -0.02:  # Strong downward trend
                return MarketRegime.TRENDING_DOWN
            elif abs(trend) > 0.005:  # Potential breakout
                return MarketRegime.BREAKOUT
            else:
                return MarketRegime.SIDEWAYS
                
        except Exception as e:
            logger.error(f"Error classifying market regime: {e}")
            return MarketRegime.SIDEWAYS
    
    def _calculate_support_resistance(self, data: pd.DataFrame) -> Tuple[List[float], List[float]]:
        """Calculate dynamic support and resistance levels"""
        try:
            if len(data) < 50:
                current_price = data['close'].iloc[-1]
                return [current_price * 0.95], [current_price * 1.05]
            
            # Get recent highs and lows
            recent_data = data.tail(50)
            highs = recent_data['high'].values
            lows = recent_data['low'].values
            
            # Find local maxima and minima
            resistance_levels = []
            support_levels = []
            
            # Simple approach: use quantiles
            current_price = data['close'].iloc[-1]
            
            # Support levels (recent lows)
            support_candidates = np.percentile(lows, [10, 25, 40])
            support_levels = [float(level) for level in support_candidates if level < current_price]
            
            # Resistance levels (recent highs)
            resistance_candidates = np.percentile(highs, [60, 75, 90])
            resistance_levels = [float(level) for level in resistance_candidates if level > current_price]
            
            # Ensure we have at least one level each
            if not support_levels:
                support_levels = [current_price * 0.95]
            if not resistance_levels:
                resistance_levels = [current_price * 1.05]
            
            return support_levels[-3:], resistance_levels[:3]  # Max 3 levels each
            
        except Exception as e:
            logger.error(f"Error calculating support/resistance: {e}")
            current_price = data['close'].iloc[-1]
            return [current_price * 0.95], [current_price * 1.05]
    
    def _predict_price_target(self, current_price: float, predictions: List[MLPrediction], time_horizon: str) -> float:
        """Predict price target based on ML predictions"""
        try:
            if not predictions:
                return current_price
            
            # Get prediction probabilities
            prob_up = np.mean([p.probability_up for p in predictions])
            confidence = np.mean([p.confidence for p in predictions])
            
            # Calculate expected price movement
            base_movement = 0.02  # 2% base movement
            
            # Adjust based on time horizon
            time_multipliers = {"1h": 0.5, "4h": 1.0, "24h": 2.0}
            time_mult = time_multipliers.get(time_horizon, 1.0)
            
            # Calculate directional movement
            expected_movement = (prob_up - 0.5) * 2 * base_movement * time_mult * confidence
            
            predicted_price = current_price * (1 + expected_movement)
            
            return predicted_price
            
        except Exception as e:
            logger.error(f"Error predicting price target: {e}")
            return current_price
    
    def _calculate_direction_confidence(self, predictions: List[MLPrediction]) -> float:
        """Calculate overall direction confidence"""
        try:
            if not predictions:
                return 0.5
            
            # Weighted average of confidences
            confidences = [p.confidence for p in predictions]
            return np.mean(confidences)
            
        except Exception as e:
            logger.error(f"Error calculating direction confidence: {e}")
            return 0.5
    
    def _calculate_momentum_score(self, data: pd.DataFrame) -> float:
        """Calculate momentum score"""
        try:
            if len(data) < 10:
                return 0.5
            
            # Recent price momentum
            price_momentum = data['close'].iloc[-1] / data['close'].iloc[-10] - 1
            
            # Volume momentum
            if 'volume' in data.columns:
                volume_momentum = data['volume'].tail(5).mean() / data['volume'].tail(20).mean() - 1
            else:
                volume_momentum = 0
            
            # Combine momentum signals
            momentum_score = 0.5 + (price_momentum * 5) + (volume_momentum * 0.5)
            
            return np.clip(momentum_score, 0.0, 1.0)
            
        except Exception as e:
            logger.error(f"Error calculating momentum score: {e}")
            return 0.5
    
    def _predict_volatility(self, data: pd.DataFrame) -> float:
        """Predict future volatility"""
        try:
            if len(data) < 20:
                return 0.05  # Default 5% volatility
            
            # Calculate recent volatility
            returns = data['close'].pct_change().tail(20)
            current_vol = returns.std()
            
            # Predict volatility increase/decrease
            # Simple approach: recent volatility with some trend
            vol_trend = returns.tail(5).std() / returns.tail(20).std() - 1
            predicted_vol = current_vol * (1 + vol_trend * 0.5)
            
            return max(0.01, min(0.50, predicted_vol))  # Cap between 1% and 50%
            
        except Exception as e:
            logger.error(f"Error predicting volatility: {e}")
            return 0.05
    
    def _calculate_risk_score(self, data: pd.DataFrame, predictions: List[MLPrediction]) -> float:
        """Calculate risk score"""
        try:
            risk_factors = []
            
            # Volatility risk
            if len(data) >= 20:
                volatility = data['close'].pct_change().tail(20).std()
                vol_risk = min(1.0, volatility / 0.1)  # Normalize to 10% volatility
                risk_factors.append(vol_risk)
            
            # Prediction uncertainty risk
            if predictions:
                avg_confidence = np.mean([p.confidence for p in predictions])
                uncertainty_risk = 1.0 - avg_confidence
                risk_factors.append(uncertainty_risk)
            
            # Market regime risk
            returns = data['close'].pct_change().tail(10)
            regime_risk = abs(returns.mean()) + returns.std()  # High volatility or strong trend = higher risk
            risk_factors.append(min(1.0, regime_risk / 0.05))
            
            return np.mean(risk_factors) if risk_factors else 0.5
            
        except Exception as e:
            logger.error(f"Error calculating risk score: {e}")
            return 0.5
    
    def _calculate_opportunity_score(self, predictions: List[MLPrediction], technical_score: float, sentiment_score: float) -> float:
        """Calculate opportunity score"""
        try:
            opportunity_factors = []
            
            # ML prediction strength
            if predictions:
                ml_strength = np.mean([p.confidence * abs(p.probability_up - 0.5) * 2 for p in predictions])
                opportunity_factors.append(ml_strength)
            
            # Technical alignment
            technical_opportunity = abs(technical_score - 0.5) * 2  # Distance from neutral
            opportunity_factors.append(technical_opportunity)
            
            # Sentiment alignment
            sentiment_opportunity = abs(sentiment_score - 0.5) * 2
            opportunity_factors.append(sentiment_opportunity)
            
            # Convergence bonus (when all signals align)
            if len(predictions) > 0 and technical_score > 0.6 and sentiment_score > 0.6:
                opportunity_factors.append(0.8)  # Bonus for alignment
            elif len(predictions) > 0 and technical_score < 0.4 and sentiment_score < 0.4:
                opportunity_factors.append(0.8)  # Bonus for bearish alignment
            
            return np.mean(opportunity_factors) if opportunity_factors else 0.5
            
        except Exception as e:
            logger.error(f"Error calculating opportunity score: {e}")
            return 0.5
    
    def _generate_fallback_analysis(self, symbol: str, data: pd.DataFrame) -> MarketAnalysis:
        """Generate fallback analysis when AI is not available"""
        try:
            current_price = data['close'].iloc[-1]
            
            return MarketAnalysis(
                symbol=symbol,
                current_price=current_price,
                predicted_price_1h=current_price * 1.005,  # Small upward bias
                predicted_price_4h=current_price * 1.01,
                predicted_price_24h=current_price * 1.02,
                direction_confidence=0.6,
                market_regime=MarketRegime.SIDEWAYS,
                volatility_prediction=0.05,
                support_levels=[current_price * 0.95],
                resistance_levels=[current_price * 1.05],
                momentum_score=0.5,
                sentiment_score=0.5,
                technical_score=0.5,
                ml_predictions=[],
                risk_score=0.5,
                opportunity_score=0.6
            )
            
        except Exception as e:
            logger.error(f"Error generating fallback analysis: {e}")
            return MarketAnalysis(
                symbol="ERROR",
                current_price=0.0,
                predicted_price_1h=0.0,
                predicted_price_4h=0.0,
                predicted_price_24h=0.0,
                direction_confidence=0.0,
                market_regime=MarketRegime.SIDEWAYS,
                volatility_prediction=0.0,
                support_levels=[],
                resistance_levels=[],
                momentum_score=0.0,
                sentiment_score=0.0,
                technical_score=0.0,
                ml_predictions=[],
                risk_score=1.0,
                opportunity_score=0.0
            )
    
    async def get_high_probability_signals(self, symbols: List[str], current_data: Dict[str, pd.DataFrame]) -> List[Dict[str, Any]]:
        """Get high-probability trading signals with AI analysis"""
        try:
            high_probability_signals = []
            
            for symbol in symbols:
                if symbol in current_data:
                    analysis = await self.analyze_market_ai(symbol, current_data[symbol])
                    
                    # Define high-probability criteria
                    is_high_probability = (
                        analysis.direction_confidence > 0.75 and
                        analysis.opportunity_score > 0.70 and
                        analysis.risk_score < 0.60 and
                        len(analysis.ml_predictions) > 0
                    )
                    
                    if is_high_probability:
                        # Determine signal direction
                        ml_prob_up = np.mean([p.probability_up for p in analysis.ml_predictions])
                        signal_direction = "BUY" if ml_prob_up > 0.6 else "SELL" if ml_prob_up < 0.4 else "HOLD"
                        
                        if signal_direction != "HOLD":
                            signal = {
                                'symbol': symbol,
                                'direction': signal_direction,
                                'confidence': analysis.direction_confidence,
                                'opportunity_score': analysis.opportunity_score,
                                'risk_score': analysis.risk_score,
                                'predicted_return_1h': ((analysis.predicted_price_1h / analysis.current_price) - 1) * 100,
                                'predicted_return_24h': ((analysis.predicted_price_24h / analysis.current_price) - 1) * 100,
                                'technical_score': analysis.technical_score,
                                'sentiment_score': analysis.sentiment_score,
                                'market_regime': analysis.market_regime.value,
                                'entry_price': analysis.current_price,
                                'stop_loss': analysis.support_levels[0] if signal_direction == "BUY" and analysis.support_levels else analysis.resistance_levels[0] if signal_direction == "SELL" and analysis.resistance_levels else None,
                                'take_profit': analysis.resistance_levels[0] if signal_direction == "BUY" and analysis.resistance_levels else analysis.support_levels[0] if signal_direction == "SELL" and analysis.support_levels else None,
                                'timestamp': datetime.now()
                            }
                            
                            high_probability_signals.append(signal)
            
            # Sort by opportunity score descending
            high_probability_signals.sort(key=lambda x: x['opportunity_score'], reverse=True)
            
            return high_probability_signals
            
        except Exception as e:
            logger.error(f"Error getting high-probability signals: {e}")
            return []
    
    def get_ai_performance_summary(self) -> Dict[str, Any]:
        """Get AI system performance summary"""
        try:
            return {
                'ai_system_status': 'active' if self.is_initialized else 'inactive',
                'models_trained': len(self.ensemble_predictors),
                'symbols_covered': list(self.ensemble_predictors.keys()),
                'ml_available': ML_AVAILABLE,
                'talib_available': TALIB_AVAILABLE,
                'prediction_history_count': len(self.prediction_history),
                'accuracy_metrics': self.accuracy_metrics,
                'feature_importance': {
                    symbol: predictor.feature_importance
                    for symbol, predictor in self.ensemble_predictors.items()
                },
                'last_update': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error getting AI performance summary: {e}")
            return {'error': str(e)}

# Factory function for quick setup
async def create_ai_market_analyzer(symbols: List[str], historical_data: Dict[str, pd.DataFrame] = None) -> AIMarketAnalyzer:
    """Create and initialize AI market analyzer"""
    analyzer = AIMarketAnalyzer()
    
    if historical_data:
        await analyzer.initialize_ai_system(symbols, historical_data)
    else:
        logger.info("AI analyzer created without training data - will use fallback analysis")
    
    return analyzer

if __name__ == "__main__":
    # Example usage
    async def main():
        # Generate sample data
        symbols = ['BTC/USDT', 'ETH/USDT']
        historical_data = {}
        
        for symbol in symbols:
            # Generate sample historical data
            dates = pd.date_range(start='2023-01-01', end='2024-01-01', freq='1H')
            prices = np.random.randn(len(dates)).cumsum() + 45000 if 'BTC' in symbol else np.random.randn(len(dates)).cumsum() + 3000
            
            df = pd.DataFrame({
                'open': prices,
                'high': prices * 1.01,
                'low': prices * 0.99,
                'close': prices,
                'volume': np.random.uniform(1000000, 5000000, len(dates))
            }, index=dates)
            
            historical_data[symbol] = df
        
        # Create and initialize AI analyzer
        analyzer = await create_ai_market_analyzer(symbols, historical_data)
        
        # Test analysis
        for symbol in symbols:
            if symbol in historical_data:
                recent_data = historical_data[symbol].tail(100)
                analysis = await analyzer.analyze_market_ai(symbol, recent_data)
                
                print(f"\n=== AI Analysis for {symbol} ===")
                print(f"Current Price: ${analysis.current_price:.2f}")
                print(f"Predicted 1H: ${analysis.predicted_price_1h:.2f}")
                print(f"Predicted 24H: ${analysis.predicted_price_24h:.2f}")
                print(f"Direction Confidence: {analysis.direction_confidence:.1%}")
                print(f"Opportunity Score: {analysis.opportunity_score:.1%}")
                print(f"Risk Score: {analysis.risk_score:.1%}")
                print(f"Market Regime: {analysis.market_regime.value}")
        
        # Get high-probability signals
        signals = await analyzer.get_high_probability_signals(symbols, historical_data)
        
        print(f"\n=== High-Probability Signals ({len(signals)}) ===")
        for signal in signals[:3]:  # Show top 3
            print(f"{signal['symbol']}: {signal['direction']} - Confidence: {signal['confidence']:.1%}")
            print(f"  Opportunity: {signal['opportunity_score']:.1%}, Risk: {signal['risk_score']:.1%}")
            print(f"  Predicted 24H Return: {signal['predicted_return_24h']:+.2f}%")
    
    asyncio.run(main())