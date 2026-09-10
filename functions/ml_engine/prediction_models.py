"""
Machine Learning Prediction Models for ThaleOS Trading Unified
Advanced ML models for price prediction, sentiment analysis, and trading signals
"""

import asyncio
import json
import logging
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Dict, List, Optional, Any, Union, Tuple
from dataclasses import dataclass, asdict
from enum import Enum
import pickle
import joblib

# ML Libraries
import tensorflow as tf
from tensorflow import keras
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.linear_model import LinearRegression, Ridge, Lasso
from sklearn.svm import SVR
from sklearn.preprocessing import StandardScaler, MinMaxScaler
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
import xgboost as xgb
import lightgbm as lgb
from transformers import pipeline, AutoTokenizer, AutoModelForSequenceClassification

# Technical Analysis
import talib
from ta import add_all_ta_features

# Feature Engineering
from scipy import stats
from sklearn.feature_selection import SelectKBest, f_regression
from sklearn.decomposition import PCA

class ModelType(Enum):
    LSTM = "lstm"
    GRU = "gru"
    TRANSFORMER = "transformer"
    RANDOM_FOREST = "random_forest"
    XGBOOST = "xgboost"
    LIGHTGBM = "lightgbm"
    CNN = "cnn"
    ENSEMBLE = "ensemble"

class PredictionHorizon(Enum):
    SHORT_TERM = "1h"      # 1 hour
    MEDIUM_TERM = "4h"     # 4 hours  
    DAILY = "1d"           # 1 day
    WEEKLY = "1w"          # 1 week
    MONTHLY = "1M"         # 1 month

@dataclass
class PredictionResult:
    """ML prediction result"""
    symbol: str
    model_type: ModelType
    horizon: PredictionHorizon
    predicted_price: float
    confidence: float  # 0-1 scale
    direction: str  # 'up', 'down', 'sideways'
    probability_up: float
    probability_down: float
    support_levels: List[float]
    resistance_levels: List[float]
    features_importance: Dict[str, float]
    model_accuracy: float
    timestamp: datetime
    expires_at: datetime

@dataclass
class SentimentAnalysis:
    """Sentiment analysis result"""
    symbol: str
    overall_sentiment: float  # -1 to 1
    news_sentiment: float
    social_sentiment: float
    fear_greed_index: float
    sentiment_score: str  # 'very_bearish', 'bearish', 'neutral', 'bullish', 'very_bullish'
    confidence: float
    sources_analyzed: int
    timestamp: datetime

class FeatureEngineer:
    """Feature engineering for ML models"""
    
    def __init__(self):
        self.scalers = {}
        self.feature_names = []
        self.lookback_periods = [5, 10, 20, 50, 100, 200]
    
    def create_technical_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create technical analysis features"""
        try:
            df = df.copy()
            
            # Price features
            df['returns'] = df['close'].pct_change()
            df['log_returns'] = np.log(df['close'] / df['close'].shift(1))
            df['volatility'] = df['returns'].rolling(20).std()
            
            # Moving averages
            for period in [5, 10, 20, 50, 100, 200]:
                df[f'sma_{period}'] = df['close'].rolling(period).mean()
                df[f'ema_{period}'] = df['close'].ewm(span=period).mean()
                df[f'price_sma_{period}_ratio'] = df['close'] / df[f'sma_{period}']
            
            # Technical indicators using TA-Lib
            if len(df) >= 200:  # Ensure sufficient data
                # Trend indicators
                df['macd'], df['macd_signal'], df['macd_hist'] = talib.MACD(df['close'])
                df['adx'] = talib.ADX(df['high'], df['low'], df['close'], timeperiod=14)
                df['aroon_up'], df['aroon_down'] = talib.AROON(df['high'], df['low'], timeperiod=14)
                
                # Momentum indicators  
                df['rsi'] = talib.RSI(df['close'], timeperiod=14)
                df['stoch_k'], df['stoch_d'] = talib.STOCH(df['high'], df['low'], df['close'])
                df['williams_r'] = talib.WILLR(df['high'], df['low'], df['close'], timeperiod=14)
                df['cci'] = talib.CCI(df['high'], df['low'], df['close'], timeperiod=14)
                df['mfi'] = talib.MFI(df['high'], df['low'], df['close'], df['volume'], timeperiod=14)
                
                # Volatility indicators
                df['bb_upper'], df['bb_middle'], df['bb_lower'] = talib.BBANDS(df['close'], timeperiod=20)
                df['bb_width'] = (df['bb_upper'] - df['bb_lower']) / df['bb_middle']
                df['bb_position'] = (df['close'] - df['bb_lower']) / (df['bb_upper'] - df['bb_lower'])
                
                df['atr'] = talib.ATR(df['high'], df['low'], df['close'], timeperiod=14)
                df['natr'] = talib.NATR(df['high'], df['low'], df['close'], timeperiod=14)
                
                # Volume indicators
                df['ad'] = talib.AD(df['high'], df['low'], df['close'], df['volume'])
                df['obv'] = talib.OBV(df['close'], df['volume'])
                df['volume_sma'] = df['volume'].rolling(20).mean()
                df['volume_ratio'] = df['volume'] / df['volume_sma']
            
            # Price patterns
            df['doji'] = talib.CDLDOJI(df['open'], df['high'], df['low'], df['close'])
            df['hammer'] = talib.CDLHAMMER(df['open'], df['high'], df['low'], df['close'])
            df['engulfing'] = talib.CDLENGULFING(df['open'], df['high'], df['low'], df['close'])
            
            # Support/Resistance levels
            df = self._add_support_resistance(df)
            
            # Market structure features
            df['higher_high'] = (df['high'] > df['high'].shift(1)) & (df['high'].shift(1) > df['high'].shift(2))
            df['lower_low'] = (df['low'] < df['low'].shift(1)) & (df['low'].shift(1) < df['low'].shift(2))
            
            # Time-based features
            df['hour'] = pd.to_datetime(df.index).hour
            df['day_of_week'] = pd.to_datetime(df.index).dayofweek
            df['month'] = pd.to_datetime(df.index).month
            
            return df
            
        except Exception as e:
            logging.error(f"Error creating technical features: {e}")
            return df
    
    def _add_support_resistance(self, df: pd.DataFrame, window: int = 20) -> pd.DataFrame:
        """Add support and resistance levels"""
        try:
            # Local minima for support
            df['support'] = df['low'].rolling(window, center=True).min()
            
            # Local maxima for resistance  
            df['resistance'] = df['high'].rolling(window, center=True).max()
            
            # Distance to support/resistance
            df['distance_to_support'] = (df['close'] - df['support']) / df['support']
            df['distance_to_resistance'] = (df['resistance'] - df['close']) / df['close']
            
            return df
            
        except Exception as e:
            logging.error(f"Error adding support/resistance: {e}")
            return df
    
    def create_market_features(self, df: pd.DataFrame, market_data: Dict[str, Any]) -> pd.DataFrame:
        """Create market-wide features"""
        try:
            # Fear & Greed Index
            df['fear_greed'] = market_data.get('fear_greed_index', 50)
            
            # VIX or volatility index
            df['market_volatility'] = market_data.get('vix', 20)
            
            # Bitcoin dominance (for crypto)
            df['btc_dominance'] = market_data.get('btc_dominance', 50)
            
            # Market cap features
            df['market_cap_rank'] = market_data.get('market_cap_rank', 100)
            
            # Correlation with major indices
            df['correlation_btc'] = market_data.get('correlation_btc', 0)
            df['correlation_eth'] = market_data.get('correlation_eth', 0)
            df['correlation_sp500'] = market_data.get('correlation_sp500', 0)
            
            return df
            
        except Exception as e:
            logging.error(f"Error creating market features: {e}")
            return df
    
    def create_sequence_features(self, df: pd.DataFrame, sequence_length: int = 60) -> np.ndarray:
        """Create sequences for LSTM/GRU models"""
        try:
            # Select numeric features only
            feature_cols = df.select_dtypes(include=[np.number]).columns
            feature_cols = [col for col in feature_cols if not col.startswith('target')]
            
            data = df[feature_cols].fillna(method='ffill').fillna(0)
            
            # Normalize features
            scaler = StandardScaler()
            scaled_data = scaler.fit_transform(data)
            
            # Store scaler
            self.scalers['sequence_scaler'] = scaler
            
            # Create sequences
            sequences = []
            for i in range(sequence_length, len(scaled_data)):
                sequences.append(scaled_data[i-sequence_length:i])
            
            return np.array(sequences)
            
        except Exception as e:
            logging.error(f"Error creating sequence features: {e}")
            return np.array([])
    
    def select_features(self, X: pd.DataFrame, y: pd.Series, k: int = 50) -> List[str]:
        """Select top k features using statistical tests"""
        try:
            # Remove non-numeric columns
            X_numeric = X.select_dtypes(include=[np.number])
            
            # Handle missing values
            X_numeric = X_numeric.fillna(X_numeric.mean())
            y = y.fillna(y.mean())
            
            # Feature selection
            selector = SelectKBest(score_func=f_regression, k=min(k, X_numeric.shape[1]))
            X_selected = selector.fit_transform(X_numeric, y)
            
            # Get selected feature names
            selected_features = X_numeric.columns[selector.get_support()].tolist()
            
            # Feature importance scores
            scores = selector.scores_
            feature_scores = dict(zip(X_numeric.columns, scores))
            
            return selected_features
            
        except Exception as e:
            logging.error(f"Error selecting features: {e}")
            return []

class LSTMPredictor:
    """LSTM-based price prediction model"""
    
    def __init__(self, sequence_length: int = 60, prediction_horizon: int = 1):
        self.sequence_length = sequence_length
        self.prediction_horizon = prediction_horizon
        self.model = None
        self.scaler = None
        self.feature_engineer = FeatureEngineer()
        
    def build_model(self, input_shape: Tuple[int, int]) -> keras.Model:
        """Build LSTM model architecture"""
        model = keras.Sequential([
            keras.layers.LSTM(128, return_sequences=True, input_shape=input_shape),
            keras.layers.Dropout(0.2),
            keras.layers.LSTM(64, return_sequences=True),
            keras.layers.Dropout(0.2),
            keras.layers.LSTM(32, return_sequences=False),
            keras.layers.Dropout(0.2),
            keras.layers.Dense(25),
            keras.layers.Dense(1, activation='linear')
        ])
        
        model.compile(
            optimizer=keras.optimizers.Adam(learning_rate=0.001),
            loss='mse',
            metrics=['mae']
        )
        
        return model
    
    async def train(self, df: pd.DataFrame, target_col: str = 'close') -> Dict[str, Any]:
        """Train the LSTM model"""
        try:
            # Feature engineering
            df_features = self.feature_engineer.create_technical_features(df)
            
            # Create sequences
            X = self.feature_engineer.create_sequence_features(df_features, self.sequence_length)
            
            # Create targets (future prices)
            y = df_features[target_col].shift(-self.prediction_horizon).dropna()
            
            # Align X and y
            min_len = min(len(X), len(y))
            X = X[-min_len:]
            y = y.iloc[-min_len:].values
            
            # Split data
            split_idx = int(len(X) * 0.8)
            X_train, X_test = X[:split_idx], X[split_idx:]
            y_train, y_test = y[:split_idx], y[split_idx:]
            
            # Build and train model
            self.model = self.build_model((X.shape[1], X.shape[2]))
            
            # Callbacks
            early_stopping = keras.callbacks.EarlyStopping(
                monitor='val_loss',
                patience=10,
                restore_best_weights=True
            )
            
            reduce_lr = keras.callbacks.ReduceLROnPlateau(
                monitor='val_loss',
                factor=0.2,
                patience=5,
                min_lr=0.0001
            )
            
            # Train model
            history = self.model.fit(
                X_train, y_train,
                epochs=100,
                batch_size=32,
                validation_data=(X_test, y_test),
                callbacks=[early_stopping, reduce_lr],
                verbose=1
            )
            
            # Evaluate model
            train_loss = self.model.evaluate(X_train, y_train, verbose=0)
            test_loss = self.model.evaluate(X_test, y_test, verbose=0)
            
            # Make predictions for evaluation
            train_pred = self.model.predict(X_train)
            test_pred = self.model.predict(X_test)
            
            # Calculate metrics
            train_rmse = np.sqrt(mean_squared_error(y_train, train_pred))
            test_rmse = np.sqrt(mean_squared_error(y_test, test_pred))
            train_r2 = r2_score(y_train, train_pred)
            test_r2 = r2_score(y_test, test_pred)
            
            return {
                'model_type': ModelType.LSTM.value,
                'train_loss': float(train_loss[0]),
                'test_loss': float(test_loss[0]),
                'train_rmse': float(train_rmse),
                'test_rmse': float(test_rmse),
                'train_r2': float(train_r2),
                'test_r2': float(test_r2),
                'epochs_trained': len(history.history['loss']),
                'sequence_length': self.sequence_length,
                'prediction_horizon': self.prediction_horizon
            }
            
        except Exception as e:
            logging.error(f"Error training LSTM model: {e}")
            return {'error': str(e)}
    
    async def predict(self, df: pd.DataFrame, steps: int = 1) -> Dict[str, Any]:
        """Make predictions using trained model"""
        try:
            if self.model is None:
                raise ValueError("Model not trained yet")
            
            # Feature engineering
            df_features = self.feature_engineer.create_technical_features(df)
            
            # Create sequences
            X = self.feature_engineer.create_sequence_features(df_features, self.sequence_length)
            
            if len(X) == 0:
                raise ValueError("Insufficient data for prediction")
            
            # Use last sequence for prediction
            last_sequence = X[-1:] 
            
            predictions = []
            confidence_intervals = []
            
            # Multi-step prediction
            current_sequence = last_sequence.copy()
            
            for step in range(steps):
                # Predict next value
                pred = self.model.predict(current_sequence, verbose=0)[0, 0]
                predictions.append(float(pred))
                
                # Calculate confidence (simplified)
                # In practice, you'd use Monte Carlo dropout or other methods
                confidence = max(0.5, 1.0 - (step * 0.1))  # Decrease confidence with horizon
                confidence_intervals.append(confidence)
                
                # Update sequence for next prediction
                if step < steps - 1:
                    # Shift sequence and add prediction
                    new_sequence = np.roll(current_sequence, -1, axis=1)
                    # This is simplified - in practice you'd need to update all features
                    new_sequence[0, -1, 0] = pred  # Assuming price is first feature
                    current_sequence = new_sequence
            
            # Determine direction
            current_price = df['close'].iloc[-1]
            predicted_price = predictions[0]
            direction = 'up' if predicted_price > current_price else 'down'
            
            # Calculate probabilities (simplified)
            price_change = abs(predicted_price - current_price) / current_price
            if direction == 'up':
                prob_up = min(0.9, 0.6 + price_change * 10)
                prob_down = 1 - prob_up
            else:
                prob_down = min(0.9, 0.6 + price_change * 10)
                prob_up = 1 - prob_down
            
            return {
                'predictions': predictions,
                'confidence_intervals': confidence_intervals,
                'direction': direction,
                'probability_up': prob_up,
                'probability_down': prob_down,
                'current_price': float(current_price),
                'predicted_price': predicted_price,
                'price_change_percent': float((predicted_price - current_price) / current_price * 100)
            }
            
        except Exception as e:
            logging.error(f"Error making LSTM predictions: {e}")
            return {'error': str(e)}

class EnsemblePredictor:
    """Ensemble model combining multiple prediction algorithms"""
    
    def __init__(self):
        self.models = {}
        self.weights = {}
        self.feature_engineer = FeatureEngineer()
        self.scaler = StandardScaler()
        
    def initialize_models(self) -> Dict[str, Any]:
        """Initialize individual models"""
        self.models = {
            'random_forest': RandomForestRegressor(
                n_estimators=100,
                max_depth=20,
                min_samples_split=5,
                min_samples_leaf=2,
                random_state=42
            ),
            'xgboost': xgb.XGBRegressor(
                n_estimators=100,
                max_depth=6,
                learning_rate=0.1,
                subsample=0.8,
                colsample_bytree=0.8,
                random_state=42
            ),
            'lightgbm': lgb.LGBMRegressor(
                n_estimators=100,
                max_depth=6,
                learning_rate=0.1,
                subsample=0.8,
                colsample_bytree=0.8,
                random_state=42,
                verbose=-1
            ),
            'gradient_boost': GradientBoostingRegressor(
                n_estimators=100,
                max_depth=6,
                learning_rate=0.1,
                subsample=0.8,
                random_state=42
            ),
            'svr': SVR(
                kernel='rbf',
                C=100,
                gamma='scale'
            )
        }
        
        return {'message': 'Models initialized', 'model_count': len(self.models)}
    
    async def train(self, df: pd.DataFrame, target_col: str = 'close') -> Dict[str, Any]:
        """Train ensemble of models"""
        try:
            # Feature engineering
            df_features = self.feature_engineer.create_technical_features(df)
            
            # Create target variable (future returns)
            df_features['target'] = df_features[target_col].shift(-1)
            df_features = df_features.dropna()
            
            # Prepare features
            feature_cols = [col for col in df_features.columns 
                          if col not in ['target'] and df_features[col].dtype in [np.float64, np.int64]]
            
            X = df_features[feature_cols].fillna(0)
            y = df_features['target']
            
            # Feature selection
            selected_features = self.feature_engineer.select_features(X, y, k=50)
            X_selected = X[selected_features]
            
            # Scale features
            X_scaled = self.scaler.fit_transform(X_selected)
            X_scaled = pd.DataFrame(X_scaled, columns=selected_features, index=X_selected.index)
            
            # Split data
            X_train, X_test, y_train, y_test = train_test_split(
                X_scaled, y, test_size=0.2, random_state=42, shuffle=False
            )
            
            # Initialize models if not done
            if not self.models:
                self.initialize_models()
            
            # Train individual models and calculate weights
            results = {}
            predictions = {}
            
            for name, model in self.models.items():
                try:
                    # Train model
                    model.fit(X_train, y_train)
                    
                    # Make predictions
                    train_pred = model.predict(X_train)
                    test_pred = model.predict(X_test)
                    
                    # Calculate metrics
                    train_rmse = np.sqrt(mean_squared_error(y_train, train_pred))
                    test_rmse = np.sqrt(mean_squared_error(y_test, test_pred))
                    test_r2 = r2_score(y_test, test_pred)
                    
                    # Store results
                    results[name] = {
                        'train_rmse': float(train_rmse),
                        'test_rmse': float(test_rmse),
                        'test_r2': float(test_r2)
                    }
                    
                    predictions[name] = test_pred
                    
                    # Calculate weight based on performance (inverse of RMSE)
                    self.weights[name] = 1 / (test_rmse + 1e-6)
                    
                except Exception as e:
                    logging.error(f"Error training {name}: {e}")
                    results[name] = {'error': str(e)}
            
            # Normalize weights
            total_weight = sum(self.weights.values())
            self.weights = {k: v / total_weight for k, v in self.weights.items()}
            
            # Calculate ensemble predictions
            ensemble_pred = np.zeros_like(y_test)
            for name, pred in predictions.items():
                if name in self.weights:
                    ensemble_pred += self.weights[name] * pred
            
            # Ensemble metrics
            ensemble_rmse = np.sqrt(mean_squared_error(y_test, ensemble_pred))
            ensemble_r2 = r2_score(y_test, ensemble_pred)
            
            results['ensemble'] = {
                'rmse': float(ensemble_rmse),
                'r2': float(ensemble_r2),
                'weights': self.weights
            }
            
            # Feature importance (from random forest)
            if 'random_forest' in self.models and 'random_forest' not in [k for k, v in results.items() if 'error' in v]:
                feature_importance = dict(zip(
                    selected_features,
                    self.models['random_forest'].feature_importances_
                ))
                results['feature_importance'] = {
                    k: float(v) for k, v in sorted(feature_importance.items(), 
                                                 key=lambda x: x[1], reverse=True)[:20]
                }
            
            return results
            
        except Exception as e:
            logging.error(f"Error training ensemble: {e}")
            return {'error': str(e)}
    
    async def predict(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Make ensemble predictions"""
        try:
            if not self.models or not self.weights:
                raise ValueError("Models not trained yet")
            
            # Feature engineering
            df_features = self.feature_engineer.create_technical_features(df)
            
            # Prepare features (use same features as training)
            feature_cols = [col for col in df_features.columns 
                          if df_features[col].dtype in [np.float64, np.int64]]
            
            X = df_features[feature_cols].fillna(0)
            
            # Use last row for prediction
            X_last = X.iloc[-1:] 
            
            # Scale features
            try:
                X_scaled = self.scaler.transform(X_last)
            except:
                # If scaler not fitted, use raw features
                X_scaled = X_last.values
            
            # Get predictions from individual models
            predictions = {}
            for name, model in self.models.items():
                if name in self.weights:
                    try:
                        pred = model.predict(X_scaled)[0]
                        predictions[name] = float(pred)
                    except Exception as e:
                        logging.error(f"Error predicting with {name}: {e}")
            
            if not predictions:
                raise ValueError("No model predictions available")
            
            # Calculate ensemble prediction
            ensemble_pred = sum(
                self.weights.get(name, 0) * pred 
                for name, pred in predictions.items()
            )
            
            # Determine direction and confidence
            current_price = df['close'].iloc[-1]
            direction = 'up' if ensemble_pred > current_price else 'down'
            
            # Calculate confidence based on model agreement
            up_votes = sum(1 for pred in predictions.values() if pred > current_price)
            total_votes = len(predictions)
            agreement = max(up_votes, total_votes - up_votes) / total_votes
            confidence = agreement
            
            # Calculate probabilities
            if direction == 'up':
                prob_up = confidence
                prob_down = 1 - confidence
            else:
                prob_down = confidence
                prob_up = 1 - confidence
            
            # Support and resistance levels (simplified)
            price_std = df['close'].rolling(20).std().iloc[-1]
            support_levels = [float(current_price - i * price_std) for i in [1, 2, 3]]
            resistance_levels = [float(current_price + i * price_std) for i in [1, 2, 3]]
            
            return {
                'predicted_price': float(ensemble_pred),
                'current_price': float(current_price),
                'direction': direction,
                'confidence': float(confidence),
                'probability_up': float(prob_up),
                'probability_down': float(prob_down),
                'price_change_percent': float((ensemble_pred - current_price) / current_price * 100),
                'individual_predictions': predictions,
                'model_weights': self.weights,
                'support_levels': support_levels,
                'resistance_levels': resistance_levels
            }
            
        except Exception as e:
            logging.error(f"Error making ensemble predictions: {e}")
            return {'error': str(e)}

class SentimentAnalyzer:
    """Sentiment analysis for market predictions"""
    
    def __init__(self):
        self.sentiment_pipeline = None
        self.initialize_models()
    
    def initialize_models(self):
        """Initialize sentiment analysis models"""
        try:
            # Initialize FinBERT for financial sentiment
            self.sentiment_pipeline = pipeline(
                "sentiment-analysis", 
                model="ProsusAI/finbert",
                tokenizer="ProsusAI/finbert"
            )
        except Exception as e:
            logging.error(f"Error initializing sentiment models: {e}")
            # Fallback to basic sentiment analysis
            self.sentiment_pipeline = pipeline("sentiment-analysis")
    
    async def analyze_news_sentiment(self, news_articles: List[str], symbol: str) -> Dict[str, Any]:
        """Analyze sentiment from news articles"""
        try:
            if not news_articles:
                return {'sentiment': 0.0, 'confidence': 0.0, 'articles_analyzed': 0}
            
            sentiments = []
            confidences = []
            
            for article in news_articles:
                if len(article) > 10:  # Skip very short articles
                    try:
                        # Truncate long articles
                        text = article[:512]
                        result = self.sentiment_pipeline(text)[0]
                        
                        # Convert to numerical sentiment
                        if result['label'] == 'positive' or result['label'] == 'POSITIVE':
                            sentiment = result['score']
                        elif result['label'] == 'negative' or result['label'] == 'NEGATIVE':
                            sentiment = -result['score']
                        else:
                            sentiment = 0.0
                        
                        sentiments.append(sentiment)
                        confidences.append(result['score'])
                        
                    except Exception as e:
                        logging.error(f"Error analyzing article sentiment: {e}")
            
            if not sentiments:
                return {'sentiment': 0.0, 'confidence': 0.0, 'articles_analyzed': 0}
            
            # Calculate weighted average sentiment
            avg_sentiment = np.average(sentiments, weights=confidences)
            avg_confidence = np.mean(confidences)
            
            return {
                'sentiment': float(avg_sentiment),
                'confidence': float(avg_confidence),
                'articles_analyzed': len(sentiments),
                'sentiment_distribution': {
                    'positive': len([s for s in sentiments if s > 0.1]),
                    'negative': len([s for s in sentiments if s < -0.1]),
                    'neutral': len([s for s in sentiments if -0.1 <= s <= 0.1])
                }
            }
            
        except Exception as e:
            logging.error(f"Error analyzing news sentiment: {e}")
            return {'sentiment': 0.0, 'confidence': 0.0, 'articles_analyzed': 0}
    
    async def analyze_social_sentiment(self, social_posts: List[str], symbol: str) -> Dict[str, Any]:
        """Analyze sentiment from social media posts"""
        try:
            # Similar to news sentiment but with different preprocessing
            if not social_posts:
                return {'sentiment': 0.0, 'confidence': 0.0, 'posts_analyzed': 0}
            
            sentiments = []
            
            for post in social_posts:
                if len(post) > 5:  # Skip very short posts
                    try:
                        # Clean social media text
                        clean_post = self._clean_social_text(post)
                        if len(clean_post) > 5:
                            result = self.sentiment_pipeline(clean_post[:256])[0]
                            
                            # Convert to numerical sentiment
                            if result['label'] == 'positive' or result['label'] == 'POSITIVE':
                                sentiment = result['score']
                            elif result['label'] == 'negative' or result['label'] == 'NEGATIVE':
                                sentiment = -result['score']
                            else:
                                sentiment = 0.0
                            
                            sentiments.append(sentiment)
                            
                    except Exception as e:
                        logging.error(f"Error analyzing social post: {e}")
            
            if not sentiments:
                return {'sentiment': 0.0, 'confidence': 0.0, 'posts_analyzed': 0}
            
            avg_sentiment = np.mean(sentiments)
            confidence = 1.0 - np.std(sentiments)  # Lower std = higher confidence
            
            return {
                'sentiment': float(avg_sentiment),
                'confidence': float(max(0.0, min(1.0, confidence))),
                'posts_analyzed': len(sentiments),
                'sentiment_distribution': {
                    'bullish': len([s for s in sentiments if s > 0.2]),
                    'bearish': len([s for s in sentiments if s < -0.2]),
                    'neutral': len([s for s in sentiments if -0.2 <= s <= 0.2])
                }
            }
            
        except Exception as e:
            logging.error(f"Error analyzing social sentiment: {e}")
            return {'sentiment': 0.0, 'confidence': 0.0, 'posts_analyzed': 0}
    
    def _clean_social_text(self, text: str) -> str:
        """Clean social media text for sentiment analysis"""
        import re
        
        # Remove URLs
        text = re.sub(r'http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+', '', text)
        
        # Remove mentions and hashtags (but keep the text)
        text = re.sub(r'[@#]\w+', '', text)
        
        # Remove extra whitespace
        text = ' '.join(text.split())
        
        return text.strip()
    
    async def get_fear_greed_index(self) -> float:
        """Get Fear & Greed index (mock implementation)"""
        try:
            # In reality, this would fetch from an API like Alternative.me
            # For now, return a mock value
            return np.random.uniform(0, 100)
            
        except Exception as e:
            logging.error(f"Error getting fear greed index: {e}")
            return 50.0  # Neutral

class MLTradingEngine:
    """Main ML engine for trading predictions"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.lstm_predictor = LSTMPredictor()
        self.ensemble_predictor = EnsemblePredictor()
        self.sentiment_analyzer = SentimentAnalyzer()
        self.models = {}
        self.predictions_cache = {}
        
    async def train_models(self, symbol: str, df: pd.DataFrame) -> Dict[str, Any]:
        """Train all ML models for a symbol"""
        try:
            results = {}
            
            # Train LSTM
            lstm_result = await self.lstm_predictor.train(df)
            results['lstm'] = lstm_result
            
            # Train Ensemble
            ensemble_result = await self.ensemble_predictor.train(df)
            results['ensemble'] = ensemble_result
            
            # Store trained models
            self.models[symbol] = {
                'lstm': self.lstm_predictor,
                'ensemble': self.ensemble_predictor,
                'trained_at': datetime.now(),
                'training_data_points': len(df)
            }
            
            return {
                'symbol': symbol,
                'models_trained': list(results.keys()),
                'training_results': results,
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logging.error(f"Error training models for {symbol}: {e}")
            return {'error': str(e)}
    
    async def get_prediction(self, symbol: str, df: pd.DataFrame, 
                           horizon: PredictionHorizon = PredictionHorizon.SHORT_TERM,
                           include_sentiment: bool = True) -> PredictionResult:
        """Get comprehensive ML prediction"""
        try:
            # Check if models exist for symbol
            if symbol not in self.models:
                # Train models first
                await self.train_models(symbol, df)
            
            predictions = {}
            
            # Get LSTM prediction
            if 'lstm' in self.models[symbol]:
                lstm_pred = await self.models[symbol]['lstm'].predict(df)
                predictions['lstm'] = lstm_pred
            
            # Get Ensemble prediction
            if 'ensemble' in self.models[symbol]:
                ensemble_pred = await self.models[symbol]['ensemble'].predict(df)
                predictions['ensemble'] = ensemble_pred
            
            # Combine predictions
            if 'ensemble' in predictions and 'error' not in predictions['ensemble']:
                main_prediction = predictions['ensemble']
            elif 'lstm' in predictions and 'error' not in predictions['lstm']:
                main_prediction = predictions['lstm']
            else:
                raise ValueError("No valid predictions available")
            
            # Get sentiment analysis if requested
            sentiment = None
            if include_sentiment:
                # This would fetch real news/social data
                news_articles = []  # Mock empty for now
                social_posts = []   # Mock empty for now
                
                news_sentiment = await self.sentiment_analyzer.analyze_news_sentiment(news_articles, symbol)
                social_sentiment = await self.sentiment_analyzer.analyze_social_sentiment(social_posts, symbol)
                fear_greed = await self.sentiment_analyzer.get_fear_greed_index()
                
                # Combine sentiment scores
                overall_sentiment = (news_sentiment['sentiment'] * 0.6 + 
                                   social_sentiment['sentiment'] * 0.4)
                
                sentiment = SentimentAnalysis(
                    symbol=symbol,
                    overall_sentiment=overall_sentiment,
                    news_sentiment=news_sentiment['sentiment'],
                    social_sentiment=social_sentiment['sentiment'],
                    fear_greed_index=fear_greed,
                    sentiment_score=self._classify_sentiment(overall_sentiment),
                    confidence=(news_sentiment['confidence'] + social_sentiment['confidence']) / 2,
                    sources_analyzed=news_sentiment['articles_analyzed'] + social_sentiment['posts_analyzed'],
                    timestamp=datetime.now()
                )
            
            # Create prediction result
            current_time = datetime.now()
            expires_at = current_time + timedelta(hours=1)  # 1 hour expiry
            
            # Adjust confidence based on sentiment alignment
            confidence = main_prediction['confidence']
            if sentiment and abs(sentiment.overall_sentiment) > 0.3:
                # If sentiment strongly agrees with price direction, increase confidence
                price_direction = 1 if main_prediction['direction'] == 'up' else -1
                sentiment_direction = 1 if sentiment.overall_sentiment > 0 else -1
                
                if price_direction == sentiment_direction:
                    confidence = min(0.95, confidence + 0.1)
                else:
                    confidence = max(0.05, confidence - 0.1)
            
            prediction_result = PredictionResult(
                symbol=symbol,
                model_type=ModelType.ENSEMBLE,
                horizon=horizon,
                predicted_price=main_prediction['predicted_price'],
                confidence=confidence,
                direction=main_prediction['direction'],
                probability_up=main_prediction['probability_up'],
                probability_down=main_prediction['probability_down'],
                support_levels=main_prediction.get('support_levels', []),
                resistance_levels=main_prediction.get('resistance_levels', []),
                features_importance=predictions.get('ensemble', {}).get('feature_importance', {}),
                model_accuracy=0.85,  # Would calculate from validation
                timestamp=current_time,
                expires_at=expires_at
            )
            
            # Cache prediction
            cache_key = f"{symbol}_{horizon.value}"
            self.predictions_cache[cache_key] = {
                'prediction': prediction_result,
                'sentiment': sentiment,
                'raw_predictions': predictions,
                'cached_at': current_time
            }
            
            return prediction_result
            
        except Exception as e:
            logging.error(f"Error getting prediction for {symbol}: {e}")
            raise
    
    def _classify_sentiment(self, sentiment_score: float) -> str:
        """Classify numerical sentiment into categories"""
        if sentiment_score > 0.5:
            return 'very_bullish'
        elif sentiment_score > 0.2:
            return 'bullish'
        elif sentiment_score > -0.2:
            return 'neutral'
        elif sentiment_score > -0.5:
            return 'bearish'
        else:
            return 'very_bearish'
    
    async def get_market_predictions(self, symbols: List[str], df_dict: Dict[str, pd.DataFrame]) -> Dict[str, Any]:
        """Get predictions for multiple symbols"""
        try:
            predictions = {}
            
            # Process each symbol
            tasks = []
            for symbol in symbols:
                if symbol in df_dict:
                    task = self.get_prediction(symbol, df_dict[symbol])
                    tasks.append((symbol, task))
            
            # Execute predictions concurrently
            results = await asyncio.gather(*[task for _, task in tasks], return_exceptions=True)
            
            # Process results
            for (symbol, _), result in zip(tasks, results):
                if isinstance(result, Exception):
                    predictions[symbol] = {'error': str(result)}
                else:
                    predictions[symbol] = asdict(result)
            
            # Calculate market-wide metrics
            valid_predictions = [p for p in predictions.values() if 'error' not in p]
            
            if valid_predictions:
                avg_confidence = np.mean([p['confidence'] for p in valid_predictions])
                bullish_count = len([p for p in valid_predictions if p['direction'] == 'up'])
                bearish_count = len([p for p in valid_predictions if p['direction'] == 'down'])
                
                market_sentiment = 'bullish' if bullish_count > bearish_count else 'bearish' if bearish_count > bullish_count else 'neutral'
            else:
                avg_confidence = 0.0
                market_sentiment = 'unknown'
            
            return {
                'predictions': predictions,
                'market_overview': {
                    'average_confidence': float(avg_confidence),
                    'market_sentiment': market_sentiment,
                    'symbols_analyzed': len(valid_predictions),
                    'bullish_signals': bullish_count if valid_predictions else 0,
                    'bearish_signals': bearish_count if valid_predictions else 0
                },
                'generated_at': datetime.now().isoformat()
            }
            
        except Exception as e:
            logging.error(f"Error getting market predictions: {e}")
            return {'error': str(e)}
    
    async def save_models(self, symbol: str, filepath: str) -> bool:
        """Save trained models to disk"""
        try:
            if symbol in self.models:
                model_data = {
                    'symbol': symbol,
                    'models': self.models[symbol],
                    'saved_at': datetime.now()
                }
                
                with open(filepath, 'wb') as f:
                    pickle.dump(model_data, f)
                
                return True
            return False
            
        except Exception as e:
            logging.error(f"Error saving models: {e}")
            return False
    
    async def load_models(self, symbol: str, filepath: str) -> bool:
        """Load trained models from disk"""
        try:
            with open(filepath, 'rb') as f:
                model_data = pickle.load(f)
            
            if model_data['symbol'] == symbol:
                self.models[symbol] = model_data['models']
                return True
            return False
            
        except Exception as e:
            logging.error(f"Error loading models: {e}")
            return False