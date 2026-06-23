import numpy as np
import pandas as pd
from sklearn.feature_selection import SelectKBest, f_regression
from sklearn.ensemble import RandomForestRegressor
import matplotlib.pyplot as plt
import seaborn as sns


class FeatureEngineer:
    """
    A class for creating and managing trading features.
    
    This class provides methods to generate various technical indicators,
    market regime features, cross-asset correlations, and calculate feature importance.
    """
    
    def __init__(self, price_data=None):
        """
        Initialize the FeatureEngineer with price data.
        
        Parameters:
        -----------
        price_data : pandas.DataFrame, optional
            DataFrame containing OHLCV data for assets.
            Should include 'Open', 'High', 'Low', 'Close', 'Volume' columns.
        """
        self.price_data = price_data
        self.features_added = []
    
    def set_price_data(self, price_data):
        """
        Set or update the price data.
        
        Parameters:
        -----------
        price_data : pandas.DataFrame
            DataFrame containing OHLCV data for assets.
        """
        self.price_data = price_data
        return self
    
    def add_basic_features(self, lagged_periods=[1, 2, 3, 5], 
                         sma_periods=[5, 10, 20, 50, 200], 
                         ema_periods=[5, 10, 20, 50, 200]):
        """
        Add basic price-based features including lagged prices, SMAs, and EMAs.
        
        Parameters:
        -----------
        lagged_periods : list
            List of periods for lagged price features.
        sma_periods : list
            List of periods for Simple Moving Average features.
        ema_periods : list
            List of periods for Exponential Moving Average features.
            
        Returns:
        --------
        self : FeatureEngineer
            Returns self for method chaining.
        """
        if self.price_data is None:
            raise ValueError("Price data not set. Use set_price_data() first.")
        
        df = self.price_data.copy()
        
        # Add lagged prices
        for period in lagged_periods:
            df[f'Lagged_Close_{period}'] = df['Close'].shift(period)
            self.features_added.append(f'Lagged_Close_{period}')
        
        # Add SMAs
        for period in sma_periods:
            df[f'SMA_{period}'] = df['Close'].rolling(window=period).mean()
            self.features_added.append(f'SMA_{period}')
        
        # Add EMAs
        for period in ema_periods:
            df[f'EMA_{period}'] = df['Close'].ewm(span=period, adjust=False).mean()
            self.features_added.append(f'EMA_{period}')
        
        self.price_data = df
        return self
    
    def add_macd(self, fast_period=12, slow_period=26, signal_period=9):
        """
        Add Moving Average Convergence Divergence (MACD) indicator.
        
        Parameters:
        -----------
        fast_period : int
            Period for the fast EMA.
        slow_period : int
            Period for the slow EMA.
        signal_period : int
            Period for the signal line.
            
        Returns:
        --------
        self : FeatureEngineer
            Returns self for method chaining.
        """
        if self.price_data is None:
            raise ValueError("Price data not set. Use set_price_data() first.")
        
        df = self.price_data.copy()
        
        # Calculate MACD components
        df['MACD_Fast'] = df['Close'].ewm(span=fast_period, adjust=False).mean()
        df['MACD_Slow'] = df['Close'].ewm(span=slow_period, adjust=False).mean()
        df['MACD_Line'] = df['MACD_Fast'] - df['MACD_Slow']
        df['MACD_Signal'] = df['MACD_Line'].ewm(span=signal_period, adjust=False).mean()
        df['MACD_Histogram'] = df['MACD_Line'] - df['MACD_Signal']
        
        # Clean up intermediate columns
        df.drop(['MACD_Fast', 'MACD_Slow'], axis=1, inplace=True)
        
        self.features_added.extend(['MACD_Line', 'MACD_Signal', 'MACD_Histogram'])
        self.price_data = df
        return self
    
    def add_bollinger_bands(self, period=20, std_dev=2):
        """
        Add Bollinger Bands indicator.
        
        Parameters:
        -----------
        period : int
            Period for the moving average.
        std_dev : float
            Number of standard deviations for the bands.
            
        Returns:
        --------
        self : FeatureEngineer
            Returns self for method chaining.
        """
        if self.price_data is None:
            raise ValueError("Price data not set. Use set_price_data() first.")
        
        df = self.price_data.copy()
        
        # Calculate Bollinger Bands
        df[f'BB_Middle_{period}'] = df['Close'].rolling(window=period).mean()
        df[f'BB_Std_{period}'] = df['Close'].rolling(window=period).std()
        df[f'BB_Upper_{period}'] = df[f'BB_Middle_{period}'] + (df[f'BB_Std_{period}'] * std_dev)
        df[f'BB_Lower_{period}'] = df[f'BB_Middle_{period}'] - (df[f'BB_Std_{period}'] * std_dev)
        
        # Calculate Bollinger Band Width and %B
        df[f'BB_Width_{period}'] = (df[f'BB_Upper_{period}'] - df[f'BB_Lower_{period}']) / df[f'BB_Middle_{period}']
        df[f'BB_PercentB_{period}'] = (df['Close'] - df[f'BB_Lower_{period}']) / (df[f'BB_Upper_{period}'] - df[f'BB_Lower_{period}'])
        
        # Clean up intermediate columns
        df.drop([f'BB_Std_{period}'], axis=1, inplace=True)
        
        self.features_added.extend([f'BB_Middle_{period}', f'BB_Upper_{period}', 
                                    f'BB_Lower_{period}', f'BB_Width_{period}', 
                                    f'BB_PercentB_{period}'])
        self.price_data = df
        return self
    
    def add_rsi(self, periods=[6, 14, 30]):
        """
        Add Relative Strength Index (RSI) indicator for multiple periods.
        
        Parameters:
        -----------
        periods : list
            List of periods for RSI calculation.
            
        Returns:
        --------
        self : FeatureEngineer
            Returns self for method chaining.
        """
        if self.price_data is None:
            raise ValueError("Price data not set. Use set_price_data() first.")
        
        df = self.price_data.copy()
        
        for period in periods:
            delta = df['Close'].diff()
            gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
            loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
            
            # Calculate RSI
            rs = gain / loss
            df[f'RSI_{period}'] = 100 - (100 / (1 + rs))
            
            # Add RSI trend features
            if period == 14:  # Only for standard 14-period RSI
                df['RSI_Trend'] = df[f'RSI_{period}'].diff(3)
                df['RSI_Overbought'] = (df[f'RSI_{period}'] > 70).astype(int)
                df['RSI_Oversold'] = (df[f'RSI_{period}'] < 30).astype(int)
                self.features_added.extend(['RSI_Trend', 'RSI_Overbought', 'RSI_Oversold'])
            
            self.features_added.append(f'RSI_{period}')
        
        self.price_data = df
        return self
    
    def add_atr(self, period=14):
        """
        Add Average True Range (ATR) indicator.
        
        Parameters:
        -----------
        period : int
            Period for ATR calculation.
            
        Returns:
        --------
        self : FeatureEngineer
            Returns self for method chaining.
        """
        if self.price_data is None:
            raise ValueError("Price data not set. Use set_price_data() first.")
        
        df = self.price_data.copy()
        
        # Calculate True Range
        df['TR_High_Low'] = df['High'] - df['Low']
        df['TR_High_Close'] = np.abs(df['High'] - df['Close'].shift(1))
        df['TR_Low_Close'] = np.abs(df['Low'] - df['Close'].shift(1))
        df['True_Range'] = df[['TR_High_Low', 'TR_High_Close', 'TR_Low_Close']].max(axis=1)
        
        # Calculate ATR
        df[f'ATR_{period}'] = df['True_Range'].rolling(window=period).mean()
        
        # Normalize ATR by price
        df[f'ATR_Percent_{period}'] = df[f'ATR_{period}'] / df['Close'] * 100
        
        # Clean up intermediate columns
        df.drop(['TR_High_Low', 'TR_High_Close', 'TR_Low_Close', 'True_Range'], axis=1, inplace=True)
        
        self.features_added.extend([f'ATR_{period}', f'ATR_Percent_{period}'])
        self.price_data = df
        return self
    
    def add_obv(self):
        """
        Add On-Balance Volume (OBV) indicator.
        
        Returns:
        --------
        self : FeatureEngineer
            Returns self for method chaining.
        """
        if self.price_data is None:
            raise ValueError("Price data not set. Use set_price_data() first.")
        
        if 'Volume' not in self.price_data.columns:
            raise ValueError("Volume data is required for OBV calculation.")
        
        df = self.price_data.copy()
        
        # Calculate OBV
        df['OBV_Signal'] = np.where(df['Close'] > df['Close'].shift(1), 1, 
                                   np.where(df['Close'] < df['Close'].shift(1), -1, 0))
        df['OBV'] = (df['Volume'] * df['OBV_Signal']).cumsum()
        
        # Calculate OBV moving averages
        df['OBV_EMA_5'] = df['OBV'].ewm(span=5, adjust=False).mean()
        df['OBV_EMA_20'] = df['OBV'].ewm(span=20, adjust=False).mean()
        
        # OBV momentum
        df['OBV_Momentum'] = df['OBV'].diff(5)
        
        # Clean up intermediate columns
        df.drop(['OBV_Signal'], axis=1, inplace=True)
        
        self.features_added.extend(['OBV', 'OBV_EMA_5', 'OBV_EMA_20', 'OBV_Momentum'])
        self.price_data = df
        return self
    
    def add_vwap(self, periods=[1, 5, 10, 20]):
        """
        Add Volume-Weighted Average Price (VWAP) for different periods.
        
        Parameters:
        -----------
        periods : list
            List of periods for VWAP calculation.
            
        Returns:
        --------
        self : FeatureEngineer
            Returns self for method chaining.
        """
        if self.price_data is None:
            raise ValueError("Price data not set. Use set_price_data() first.")
        
        if 'Volume' not in self.price_data.columns:
            raise ValueError("Volume data is required for VWAP calculation.")
        
        df = self.price_data.copy()
        
        # Calculate typical price
        df['Typical_Price'] = (df['High'] + df['Low'] + df['Close']) / 3
        
        # Calculate VWAP for different periods
        for period in periods:
            df[f'VP_{period}'] = df['Typical_Price'] * df['Volume']
            df[f'VWAP_{period}'] = df[f'VP_{period}'].rolling(window=period).sum() / df['Volume'].rolling(window=period).sum()
            
            # VWAP distance
            df[f'VWAP_Distance_{period}'] = (df['Close'] - df[f'VWAP_{period}']) / df[f'VWAP_{period}'] * 100
            
            # Clean up intermediate columns
            df.drop([f'VP_{period}'], axis=1, inplace=True)
            
            self.features_added.extend([f'VWAP_{period}', f'VWAP_Distance_{period}'])
        
        # Clean up intermediate columns
        df.drop(['Typical_Price'], axis=1, inplace=True)
        
        self.price_data = df
        return self
    
    def add_volatility_metrics(self, periods=[5, 10, 20, 50]):
        """
        Add various volatility metrics.
        
        Parameters:
        -----------
        periods : list
            List of periods for volatility calculations.
            
        Returns:
        --------
        self : FeatureEngineer
            Returns self for method chaining.
        """
        if self.price_data is None:
            raise ValueError("Price data not set. Use set_price_data() first.")
        
        df = self.price_data.copy()
        
        # Calculate return
        df['Daily_Return'] = df['Close'].pct_change() * 100
        
        for period in periods:
            # Standard volatility (standard deviation of returns)
            df[f'Volatility_{period}'] = df['Daily_Return'].rolling(window=period).std()
            
            # Normalized volatility (annualized)
            df[f'Volatility_Ann_{period}'] = df[f'Volatility_{period}'] * (252 ** 0.5)
            
            # High-Low range volatility
            df[f'HL_Range_{period}'] = ((df['High'] / df['Low'] - 1) * 100).rolling(window=period).mean()
            
            # Volatility trend
            if period == 20:  # Only for the standard 20-day volatility
                df['Volatility_Trend'] = df[f'Volatility_{period}'].diff(5)
                self.features_added.append('Volatility_Trend')
            
            self.features_added.extend([f'Volatility_{period}', f'Volatility_Ann_{period}', f'HL_Range_{period}'])
        
        self.price_data = df
        self.features_added.append('Daily_Return')
        return self
    
    def add_trend_indicators(self):
        """
        Add trend strength indicators.
        
        Returns:
        --------
        self : FeatureEngineer
            Returns self for method chaining.
        """
        if self.price_data is None:
            raise ValueError("Price data not set. Use set_price_data() first.")
        
        df = self.price_data.copy()
        
        # ADX (Average Directional Index) approximation
        df['DMI_Plus'] = np.where(df['High'].diff() > -df['Low'].diff(), 
                                 np.maximum(df['High'].diff(), 0), 0)
        df['DMI_Minus'] = np.where(-df['Low'].diff() > df['High'].diff(), 
                                  np.maximum(-df['Low'].diff(), 0), 0)
        
        # Smooth with EMA
        df['DMI_Plus_14'] = df['DMI_Plus'].ewm(span=14, adjust=False).mean()
        df['DMI_Minus_14'] = df['DMI_Minus'].ewm(span=14, adjust=False).mean()
        
        # ATR 14
        if f'ATR_14' not in df.columns:
            self.add_atr(period=14)
            df = self.price_data.copy()
        
        # Calculate DI values
        df['DI_Plus'] = 100 * df['DMI_Plus_14'] / df['ATR_14']
        df['DI_Minus'] = 100 * df['DMI_Minus_14'] / df['ATR_14']
        
        # Calculate directional movement
        df['DX'] = 100 * np.abs(df['DI_Plus'] - df['DI_Minus']) / (df['DI_Plus'] + df['DI_Minus'])
        
        # Calculate ADX
        df['ADX'] = df['DX'].ewm(span=14, adjust=False).mean()
        
        # Calculate Trend strength (custom indicator)
        sma_20 = df['Close'].rolling(window=20).mean()
        sma_50 = df['Close'].rolling(window=50).mean()
        sma_200 = df['Close'].rolling(window=200).mean()
        
        df['Trend_20_50'] = sma_20 / sma_50 - 1
        df['Trend_20_200'] = sma_20 / sma_200 - 1
        df['Trend_50_200'] = sma_50 / sma_200 - 1
        
        # Golden Cross / Death Cross
        df['Golden_Cross'] = (df['Trend_50_200'] > 0).astype(int)
        df['Cross_Change'] = df['Golden_Cross'].diff()
        
        # Clean up intermediate columns
        df.drop(['DMI_Plus', 'DMI_Minus', 'DMI_Plus_14', 'DMI_Minus_14', 'DX'], axis=1, inplace=True)
        
        self.features_added.extend(['DI_Plus', 'DI_Minus', 'ADX', 'Trend_20_50', 
                                    'Trend_20_200', 'Trend_50_200', 'Golden_Cross', 'Cross_Change'])
        self.price_data = df
        return self
    
    def add_momentum_indicators(self, periods=[5, 10, 20, 50, 100, 200]):
        """
        Add momentum indicators at multiple timeframes.
        
        Parameters:
        -----------
        periods : list
            List of periods for momentum calculations.
            
        Returns:
        --------
        self : FeatureEngineer
            Returns self for method chaining.
        """
        if self.price_data is None:
            raise ValueError("Price data not set. Use set_price_data() first.")
        
        df = self.price_data.copy()
        
        for period in periods:
            # Price momentum (rate of change)
            df[f'ROC_{period}'] = df['Close'].pct_change(period) * 100
            
            # Normalized momentum
            df[f'Norm_ROC_{period}'] = df[f'ROC_{period}'] / df[f'Volatility_{20}'] if f'Volatility_{20}' in df.columns else np.nan
            
            self.features_added.extend([f'ROC_{period}', f'Norm_ROC_{period}'])
        
        # Momentum divergence indicators
        df['ROC_Accel_5'] = df['ROC_5'].diff(3)
        
        self.features_added.append('ROC_Accel_5')
        self.price_data = df
        return self
    
    def add_cross_asset_correlations(self, asset_data_dict, periods=[10, 20, 60]):
        """
        Add cross-asset correlation features.
        
        Parameters:
        -----------
        asset_data_dict : dict
            Dictionary mapping asset names to their price DataFrames.
            Each DataFrame should have a 'Close' column.
        periods : list
            List of periods for correlation calculations.
            
        Returns:
        --------
        self : FeatureEngineer
            Returns self for method chaining.
        """
        if self.price_data is None:
            raise ValueError("Price data not set. Use set_price_data() first.")
        
        df = self.price_data.copy()
        base_asset_returns = df['Close'].pct_change()
        
        for asset_name, asset_data in asset_data_dict.items():
            if asset_data is None or 'Close' not in asset_data.columns:
                continue
                
            # Get returns for comparison asset
            compare_returns = asset_data['Close'].pct_change()
            
            # Make sure the indices match
            common_idx = df.index.intersection(asset_data.index)
            if len(common_idx) == 0:
                continue
                
            base_returns_aligned = base_asset_returns.loc[common_idx]
            compare_returns_aligned = compare_returns.loc[common_idx]
            
            # Calculate rolling correlations
            for period in periods:
                # Handle cases where we don't have enough data
                if len(common_idx) < period + 5:
                    continue
                    
                corr_series = base_returns_aligned.rolling(window=period).corr(compare_returns_aligned)
                
                # Map back to original dataframe
                df[f'Corr_{asset_name}_{period}'] = np.nan
                df.loc[common_idx, f'Corr_{asset_name}_{period}'] = corr_series
                
                self.features_added.append(f'Corr_{asset_name}_{period}')
                
            # Calculate relative strength (performance relative to the compared asset)
            df[f'RelStrength_{asset_name}_20'] = np.nan
            
            # Calculate 20-day returns for both assets
            base_20d_returns = df['Close'].pct_change(20)
            compare_20d_returns = asset_data['Close'].pct_change(20)
            
            # Calculate relative performance
            common_idx_20d = df.index.intersection(asset_data.index)
            if len(common_idx_20d) > 0:
                df.loc[common_idx_20d, f'RelStrength_{asset_name}_20'] = (
                    base_20d_returns.loc[common_idx_20d] - compare_20d_returns.loc[common_idx_20d]
                )
                
            self.features_added.append(f'RelStrength_{asset_name}_20')
        
        self.price_data = df
        return self
    
    def calculate_feature_importance(self, target_column, lag_target=1, top_n=20, 
                                      method='random_forest', plot=False):
        """
        Calculate and display feature importance.
        
        Parameters:
        -----------
        target_column : str
            The column name to use as the prediction target.
        lag_target : int
            Number of periods to lag the target for prediction.
        top_n : int
            Number of top features to display.
        method : str
            Method to use for feature importance ('random_forest' or 'f_regression').
        plot : bool
            Whether to plot the feature importance.
            
        Returns:
        --------
        pandas.DataFrame
            DataFrame with feature importance scores.
        """
        if self.price_data is None:
            raise ValueError("Price data not set. Use set_price_data() first.")
        
        df = self.price_data.copy()
        
        # Create target variable (future return)
        df[f'Target_{target_column}_{lag_target}'] = df[target_column].shift(-lag_target)
        
        # Drop rows with NaN values
        df.dropna(inplace=True)
        
        # Separate features and target
        X = df.drop([f'Target_{target_column}_{lag_target}'], axis=1)
        y = df[f'Target_{target_column}_{lag_target}']
        
        # Drop non-numeric columns
        X = X.select_dtypes(include=['float64', 'int64'])
        
        # Calculate feature importance
        if method == 'random_forest':
            model = RandomForestRegressor(n_estimators=100, random_state=42)
            model.fit(X, y)
            importance = pd.DataFrame({
                'Feature': X.columns,
                'Importance': model.feature_importances_
            })
        elif method == 'f_regression':
            selector = SelectKBest(score_func=f_regression, k='all')
            selector.fit(X, y)
            importance = pd.DataFrame({
                'Feature': X.columns,
                'Importance': selector.scores_
            })
        else:
            raise ValueError("Method must be 'random_forest' or 'f_regression'")
        
        # Sort by importance
        importance = importance.sort_values('Importance', ascending=False).reset_index(drop=True)
        
        # Display top features
        top_features = importance.head(top_n)
        
        # Plot if requested
        if plot:
            plt.figure(figsize=(10, 8))
            sns.barplot(x='Importance', y='Feature', data=top_features)
            plt.title(f'Top {top_n} Feature Importance for {target_column} Prediction')
            plt.tight_layout()
            plt.show()
        
        return importance
    
    def get_feature_names(self):
        """Get the list of features added to the dataset."""
        return self.features_added
    
    def get_data(self):
        """Get the processed DataFrame with all added features."""
        if self.price_data is None:
            raise ValueError("No data available. Use set_price_data() first.")
        return self.price_data.copy()


def create_features(price_data, include_all=True, asset_data_dict=None):
    """
    Create features for machine learning models.
    
    This function creates a comprehensive set of features for trading and investment models.
    It serves as a wrapper around the FeatureEngineer class for backward compatibility.
    
    Parameters:
    -----------
    price_data : pandas.DataFrame
        DataFrame containing OHLCV data for assets.
    include_all : bool
        Whether to include all features or just basic ones.
    asset_data_dict : dict, optional
        Dictionary mapping asset names to their price DataFrames for correlation features.
        
    Returns:
    --------
    pandas.DataFrame
        DataFrame with all requested features added.
    """
    engineer = FeatureEngineer(price_data)
    
    # Always add basic features
    engineer.add_basic_features()
    
    if include_all:
        # Add all advanced features
        engineer.add_macd()
        engineer.add_bollinger_bands()
        engineer.add_rsi()
        engineer.add_atr()
        
        # Add volume-based indicators if volume data is available
        if 'Volume' in price_data.columns:
            engineer.add_obv()
            engineer.add_vwap()
        
        # Add market regime features
        engineer.add_volatility_metrics()
        engineer.add_trend_indicators()
        engineer.add_momentum_indicators()
        
        # Add cross-asset correlations if data is provided
        if asset_data_dict is not None:
            engineer.add_cross_asset_correlations(asset_data_dict)
    
    # Get the processed data and drop NA values
    result_data = engineer.get_data()
    result_data.dropna(inplace=True)
    
    return result_data
